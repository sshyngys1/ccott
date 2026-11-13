//! Event-driven, local-only pipe. The protected DACL grants access to the process user's SID only.
use super::model::MAX_MESSAGE;
use std::{
    sync::{Arc, mpsc},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::*,
        Security::{Authorization::*, *},
        Storage::FileSystem::*,
        System::{IO::*, Pipes::*, Threading::*},
    },
    core::{PCWSTR, PWSTR},
};

pub use super::model::PIPE_NAME;
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: this type owns a valid Win32 handle, closed exactly once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
struct Descriptor(PSECURITY_DESCRIPTOR);
impl Drop for Descriptor {
    fn drop(&mut self) {
        // SAFETY: ConvertStringSecurityDescriptor allocates with LocalAlloc.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.0.0)));
        }
    }
}
fn user_descriptor() -> windows::core::Result<Descriptor> {
    // SAFETY: all buffers remain alive for the calls; token buffer is pointer-aligned and sized by Windows.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)?;
        let token = OwnedHandle(token);
        let mut size = 0;
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
        let mut buf = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buf.as_mut_ptr().cast()),
            size,
            &mut size,
        )?;
        let user = &*buf.as_ptr().cast::<TOKEN_USER>();
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid)?;
        let sid_text = sid.to_string();
        let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
        let sddl = wide(&format!("D:P(A;;GA;;;{})", sid_text?));
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            1,
            &mut descriptor,
            None,
        )?;
        Ok(Descriptor(descriptor))
    }
}
fn open_server(name: &str) -> windows::core::Result<OwnedHandle> {
    let descriptor = user_descriptor()?;
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0.0,
        bInheritHandle: false.into(),
    };
    let name = wide(name);
    // SAFETY: name/ACL live through creation. FIRST_PIPE_INSTANCE prevents impersonation by another server.
    let handle = unsafe {
        CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            0,
            (MAX_MESSAGE + 1) as u32,
            0,
            Some(&sa),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(windows::core::Error::from_thread());
    }
    Ok(OwnedHandle(handle))
}

struct StopEvent(OwnedHandle);
// SAFETY: an event handle may be signalled/waited on by multiple threads; Arc keeps it alive.
unsafe impl Send for StopEvent {}
// SAFETY: SetEvent and waits do not mutate Rust memory behind the shared handle.
unsafe impl Sync for StopEvent {}

fn event() -> windows::core::Result<OwnedHandle> {
    // SAFETY: unnamed manual-reset event with no inherited handle or external pointers.
    unsafe { CreateEventW(None, true, false, None).map(OwnedHandle) }
}

/// Keeps OVERLAPPED at a fixed address, and drains cancellation before its memory is freed.
struct PipeIo {
    pipe: OwnedHandle,
    event: OwnedHandle,
    overlapped: Box<OVERLAPPED>,
    pending: bool,
}
impl PipeIo {
    fn new(name: &str) -> windows::core::Result<Self> {
        let event = event()?;
        let overlapped = Box::new(OVERLAPPED {
            hEvent: event.0,
            ..Default::default()
        });
        Ok(Self {
            pipe: open_server(name)?,
            event,
            overlapped,
            pending: false,
        })
    }
    fn reset(&mut self) -> windows::core::Result<()> {
        debug_assert!(!self.pending);
        // SAFETY: the previous operation has completed and this event is owned here.
        unsafe { ResetEvent(self.event.0)? };
        *self.overlapped = OVERLAPPED {
            hEvent: self.event.0,
            ..Default::default()
        };
        Ok(())
    }
    fn begin(&mut self, result: windows::core::Result<()>) -> windows::core::Result<()> {
        match result {
            Err(e) if e.code() == ERROR_IO_PENDING.to_hresult() => {
                self.pending = true;
                Ok(())
            }
            other => other,
        }
    }
    fn connect(&mut self) -> windows::core::Result<()> {
        self.reset()?;
        // SAFETY: pipe and boxed OVERLAPPED remain alive until completion or cancellation.
        let result = unsafe { ConnectNamedPipe(self.pipe.0, Some(&mut *self.overlapped)) };
        if result.as_ref().err().is_some_and(|e| {
            e.code() == ERROR_PIPE_CONNECTED.to_hresult() || e.code() == ERROR_NO_DATA.to_hresult()
        }) {
            return Ok(());
        }
        self.begin(result)
    }
    fn read(&mut self, buffer: &mut [u8]) -> windows::core::Result<()> {
        self.reset()?;
        // SAFETY: the caller keeps buffer alive and cancels/drains before reusing or freeing it.
        let result =
            unsafe { ReadFile(self.pipe.0, Some(buffer), None, Some(&mut *self.overlapped)) };
        self.begin(result)
    }
    fn finish(&mut self) -> windows::core::Result<u32> {
        let mut read = 0;
        // SAFETY: used only after synchronous completion or the operation's event is signalled.
        let result =
            unsafe { GetOverlappedResult(self.pipe.0, &*self.overlapped, &mut read, false) };
        self.pending = false;
        result.map(|()| read)
    }
    fn cancel(&mut self) {
        if self.pending {
            // SAFETY: cancellation is followed by a blocking drain, including completion races.
            unsafe {
                let _ = CancelIoEx(self.pipe.0, Some(&*self.overlapped));
                let _ = GetOverlappedResult(self.pipe.0, &*self.overlapped, &mut 0, true);
            }
            self.pending = false;
        }
    }
    fn disconnect(&mut self) {
        self.cancel();
        // SAFETY: this worker owns the server endpoint, with no outstanding I/O.
        unsafe {
            let _ = DisconnectNamedPipe(self.pipe.0);
        }
    }
}
impl Drop for PipeIo {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[derive(Default)]
struct WaitStats {
    #[cfg(test)]
    entered: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    wakeups: std::sync::atomic::AtomicUsize,
}
impl WaitStats {
    fn wait(&self, stop: &StopEvent, io: &PipeIo, timeout: u32) -> WAIT_EVENT {
        #[cfg(test)]
        self.entered
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // SAFETY: both event handles remain valid for the entire wait. Stop wins simultaneous signals.
        let result = unsafe { WaitForMultipleObjects(&[stop.0.0, io.event.0], false, timeout) };
        #[cfg(test)]
        self.wakeups
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        result
    }
}

pub struct Server {
    stop: Arc<StopEvent>,
    thread: Option<JoinHandle<()>>,
    #[cfg(test)]
    stats: Arc<WaitStats>,
}
impl Server {
    /// `receive(None)` prunes sessions; its return value enables retention while sessions remain.
    pub fn start(
        name: String,
        receive: impl FnMut(Option<&[u8]>) -> bool + Send + 'static,
    ) -> Result<Self, String> {
        Self::start_with_retention(name, receive, 60_000)
    }
    fn start_with_retention(
        name: String,
        mut receive: impl FnMut(Option<&[u8]>) -> bool + Send + 'static,
        retention_ms: u32,
    ) -> Result<Self, String> {
        let stop = Arc::new(StopEvent(event().map_err(|e| e.to_string())?));
        let worker_stop = stop.clone();
        let stats = Arc::new(WaitStats::default());
        let worker_stats = stats.clone();
        let (ready, started) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("agents-pipe".into())
            .spawn(move || {
                // The read buffer outlives PipeIo, including cancellation during unwinding.
                let mut buffer = [0u8; MAX_MESSAGE + 1];
                let mut io = match PipeIo::new(&name) {
                    Ok(io) => io,
                    Err(e) => {
                        let _ = ready.send(Err(e.to_string()));
                        return;
                    }
                };
                let _ = ready.send(Ok(()));
                let mut has_sessions = false;
                let mut bytes = Vec::new();
                'server: loop {
                    // SAFETY: the shared event stays alive until this worker has joined.
                    if unsafe { WaitForSingleObject(worker_stop.0.0, 0) } != WAIT_TIMEOUT {
                        break;
                    }
                    if io.connect().is_err() {
                        break;
                    }
                    while io.pending {
                        let timeout = if has_sessions { retention_ms } else { INFINITE };
                        match worker_stats.wait(&worker_stop, &io, timeout) {
                            WAIT_TIMEOUT => has_sessions = receive(None),
                            result if result == WAIT_EVENT(WAIT_OBJECT_0.0 + 1) => {
                                if io.finish().is_err() {
                                    io.disconnect();
                                    continue 'server;
                                }
                            }
                            _ => break 'server,
                        }
                    }
                    let deadline = Instant::now() + Duration::from_millis(100);
                    let mut oversized = false;
                    bytes.clear();
                    loop {
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        // Bound a client even if it sends continuously; check stop between reads.
                        // SAFETY: the stop event stays alive for the worker's lifetime.
                        if remaining.is_zero()
                            || unsafe { WaitForSingleObject(worker_stop.0.0, 0) } != WAIT_TIMEOUT
                        {
                            break;
                        }
                        if io.read(&mut buffer).is_err() {
                            break;
                        }
                        if io.pending {
                            match worker_stats.wait(
                                &worker_stop,
                                &io,
                                remaining.as_millis().max(1) as u32,
                            ) {
                                result if result == WAIT_EVENT(WAIT_OBJECT_0.0 + 1) => {}
                                WAIT_TIMEOUT => break,
                                _ => break 'server,
                            }
                        }
                        let Ok(read) = io.finish() else { break };
                        if read == 0 {
                            break;
                        }
                        for &byte in &buffer[..read as usize] {
                            if byte == b'\n' {
                                if !oversized {
                                    has_sessions = receive(Some(&bytes));
                                }
                                bytes.clear();
                                oversized = false;
                            } else if bytes.len() < MAX_MESSAGE {
                                bytes.push(byte);
                            } else {
                                oversized = true;
                            }
                        }
                    }
                    io.disconnect();
                }
                // PipeIo cancels and drains pending connect/read before freeing OVERLAPPED/buffer.
            })
            .map_err(|e| e.to_string())?;
        match started.recv() {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
                #[cfg(test)]
                stats,
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(error) => {
                let _ = thread.join();
                Err(error.to_string())
            }
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        // SAFETY: Arc keeps the event alive through signalling and the worker's final wait.
        unsafe {
            let _ = SetEvent(self.stop.0.0);
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

pub fn set_enabled(
    server: &mut Option<Server>,
    enabled: bool,
    name: &str,
    receive: impl FnMut(Option<&[u8]>) -> bool + Send + 'static,
) -> Result<(), String> {
    if enabled && server.is_some() {
        return Ok(());
    }
    drop(server.take()); // closes the pipe and joins before returning or restarting
    if enabled {
        *server = Some(Server::start(name.into(), receive)?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::pipe_sender::{send, try_send};
    use super::*;
    use std::sync::atomic::Ordering;

    fn wait_until_blocked(server: &Server, minimum_waits: usize) {
        let deadline = Instant::now() + Duration::from_secs(1);
        while server.stats.entered.load(Ordering::SeqCst) < minimum_waits {
            assert!(Instant::now() < deadline, "server did not enter event wait");
            thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn idle_has_zero_wakeups_and_stop_interrupts_pending_connect() {
        let name = format!(r"\\.\pipe\ccott-agents-idle-{}", std::process::id());
        let server =
            Server::start(name.clone(), |_| panic!("idle must not run retention")).unwrap();
        wait_until_blocked(&server, 1);
        thread::sleep(Duration::from_millis(150));
        assert_eq!(server.stats.entered.load(Ordering::SeqCst), 1);
        assert_eq!(server.stats.wakeups.load(Ordering::SeqCst), 0);
        let start = Instant::now();
        drop(server);
        assert!(start.elapsed() < Duration::from_millis(100));
        drop(Server::start(name, |_| false).unwrap());
    }

    #[test]
    fn retention_timer_stops_after_last_session_expires() {
        let name = format!(r"\\.\pipe\ccott-agents-retention-{}", std::process::id());
        let (tx, rx) = mpsc::channel();
        // Short injected retention period; production uses 60 seconds.
        let server = Server::start_with_retention(
            name.clone(),
            move |line| {
                let _ = tx.send(line.is_some());
                line.is_some() // one message creates a session; the first retention removes it
            },
            30,
        )
        .unwrap();
        try_send(&name, b"session\n").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(1)).unwrap());
        assert!(!rx.recv_timeout(Duration::from_secs(1)).unwrap());
        let wakeups = server.stats.wakeups.load(Ordering::SeqCst);
        wait_until_blocked(&server, wakeups + 1);
        thread::sleep(Duration::from_millis(150));
        assert_eq!(server.stats.wakeups.load(Ordering::SeqCst), wakeups);
        assert!(rx.try_recv().is_err());
        drop(server);
    }
    #[test]
    fn disabled_starts_nothing_enable_restarts_and_disable_joins() {
        let name = format!(r"\\.\pipe\ccott-agents-lifecycle-{}", std::process::id());
        let mut server = None;
        set_enabled(&mut server, false, &name, |_| false).unwrap();
        assert!(server.is_none());
        for _ in 0..2 {
            set_enabled(&mut server, true, &name, |_| false).unwrap();
            set_enabled(&mut server, true, &name, |_| false).unwrap();
            assert!(server.is_some());
            set_enabled(&mut server, false, &name, |_| false).unwrap();
            assert!(server.is_none());
            drop(Server::start(name.clone(), |_| false).unwrap());
        }
    }
    #[test]
    fn server_lifecycle_and_delivery() {
        let name = format!(r"\\.\pipe\ccott-agents-test-{}", std::process::id());
        let (tx, rx) = mpsc::channel();
        let server = Server::start(name.clone(), move |line| {
            if let Some(line) = line {
                let _ = tx.send(line.to_vec());
            }
            false
        })
        .unwrap();
        try_send(&name, b"one\ntwo\n").unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), b"one");
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), b"two");
        let start = Instant::now();
        drop(server); // closes and joins
        assert!(start.elapsed() < Duration::from_millis(100));
        let server = Server::start(name.clone(), |_| false).unwrap(); // endpoint released
        drop(server);
        let start = Instant::now();
        send(&name, b"ignored\n");
        assert!(start.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn busy_client_does_not_block_sender_or_shutdown() {
        let name = format!(r"\\.\pipe\ccott-agents-busy-test-{}", std::process::id());
        let server = Server::start(name.clone(), |_| false).unwrap();
        wait_until_blocked(&server, 1);
        let wide_name = wide(&name);
        // SAFETY: this test owns the connected client handle; it deliberately sends no data.
        let client = OwnedHandle(
            unsafe {
                CreateFileW(
                    PCWSTR(wide_name.as_ptr()),
                    GENERIC_WRITE.0,
                    FILE_SHARE_NONE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES::default(),
                    None,
                )
            }
            .unwrap(),
        );
        let start = Instant::now();
        assert!(try_send(&name, b"ignored\n").is_err());
        assert!(start.elapsed() < Duration::from_millis(100));
        wait_until_blocked(&server, 2); // the silent client's overlapped read is pending
        let start = Instant::now();
        drop(server);
        assert!(start.elapsed() < Duration::from_millis(100));
        drop(client);
    }

    #[test]
    fn oversized_line_is_dropped_and_next_line_survives() {
        let name = format!(r"\\.\pipe\ccott-agents-size-test-{}", std::process::id());
        let (tx, rx) = mpsc::channel();
        let server = Server::start(name.clone(), move |line| {
            if let Some(line) = line {
                let _ = tx.send(line.to_vec());
            }
            false
        })
        .unwrap();
        let mut oversized = vec![b'a'; MAX_MESSAGE + 1];
        oversized.extend_from_slice(b"\nvalid\n");
        let wide_name = wide(&name);
        // SAFETY: the test owns this blocking client. Unlike a hook it sends more than the pipe buffer.
        let client = OwnedHandle(
            unsafe {
                CreateFileW(
                    PCWSTR(wide_name.as_ptr()),
                    GENERIC_WRITE.0,
                    FILE_SHARE_NONE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES::default(),
                    None,
                )
            }
            .unwrap(),
        );
        // SAFETY: the buffer stays alive through this synchronous test-only write.
        unsafe { WriteFile(client.0, Some(&oversized), None, None) }.unwrap();
        drop(client);
        assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), b"valid");
        drop(server);
    }
}
