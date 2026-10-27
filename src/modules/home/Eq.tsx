/** Four-bar equalizer (`.ig-eq`); animates only with data-playing="true". */
export function Eq({ playing }: { playing: boolean }) {
  return (
    <span className="ig-eq" data-playing={playing} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
