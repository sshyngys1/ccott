//! Small, apartment-local IDispatch adapter for the installed Windows ADO provider.
use windows::{
    Win32::System::{Com::*, Variant::VARIANT},
    core::{GUID, PCWSTR},
};

pub struct Dispatch(IDispatch);
impl Dispatch {
    pub fn create(progid: &str) -> windows::core::Result<Self> {
        let name: Vec<_> = progid.encode_utf16().chain(Some(0)).collect();
        // SAFETY: caller initialized COM; NUL-terminated name is live and interface stays in this apartment.
        unsafe {
            Ok(Self(CoCreateInstance(
                &CLSIDFromProgID(PCWSTR(name.as_ptr()))?,
                None,
                CLSCTX_INPROC_SERVER,
            )?))
        }
    }
    pub fn from(value: &VARIANT) -> windows::core::Result<Self> {
        Ok(Self(IDispatch::try_from(value)?))
    }
    pub fn get(&self, name: &str) -> windows::core::Result<VARIANT> {
        self.invoke(name, DISPATCH_PROPERTYGET, vec![])
    }
    pub fn call(&self, name: &str, args: Vec<VARIANT>) -> windows::core::Result<VARIANT> {
        self.invoke(name, DISPATCH_METHOD, args)
    }
    pub fn item(&self, key: &str) -> windows::core::Result<Self> {
        Self::from(&self.invoke("Item", DISPATCH_PROPERTYGET, vec![key.into()])?)
    }
    pub fn put(&self, name: &str, value: VARIANT) -> windows::core::Result<()> {
        self.invoke(name, DISPATCH_PROPERTYPUT, vec![value])
            .map(|_| ())
    }
    fn invoke(
        &self,
        name: &str,
        flags: DISPATCH_FLAGS,
        mut args: Vec<VARIANT>,
    ) -> windows::core::Result<VARIANT> {
        let name: Vec<_> = name.encode_utf16().chain(Some(0)).collect();
        let mut id = 0;
        let iid = GUID::zeroed();
        let mut result = VARIANT::default();
        args.reverse();
        let mut put_id = -3; // DISPID_PROPERTYPUT
        let params = DISPPARAMS {
            rgvarg: args.as_mut_ptr(),
            rgdispidNamedArgs: if flags == DISPATCH_PROPERTYPUT {
                &mut put_id
            } else {
                std::ptr::null_mut()
            },
            cArgs: args.len() as u32,
            cNamedArgs: u32::from(flags == DISPATCH_PROPERTYPUT),
        };
        // SAFETY: COM object belongs to this apartment. All names, reversed VARIANT arguments and
        // output storage live through Invoke; VARIANT owns and releases returned BSTR/interfaces.
        unsafe {
            self.0
                .GetIDsOfNames(&iid, &PCWSTR(name.as_ptr()), 1, 0, &mut id)?;
            self.0
                .Invoke(id, &iid, 0, flags, &params, Some(&mut result), None, None)?;
        }
        Ok(result)
    }
}
