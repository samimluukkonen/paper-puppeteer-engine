/** Download serialized JSON and release its temporary URL after the browser starts reading it. */
export function downloadJson(json: string, filename: string): void {
  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
}

/** Start an explicit browser download; never writes to the source repository. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
