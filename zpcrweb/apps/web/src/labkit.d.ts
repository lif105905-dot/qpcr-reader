/** The shell's bridge, present only when the page runs inside the LabKit desktop window. */
interface LabKitBridge {
  openQpcr?: () => void;
  goHome?: () => void;
}

interface Window {
  labkit?: LabKitBridge;
}
