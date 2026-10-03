/** Download serialized JSON and release its temporary URL after the browser starts reading it. */
export function downloadJson(json: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
