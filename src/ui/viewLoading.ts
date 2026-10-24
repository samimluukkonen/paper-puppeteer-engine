/** Keep the initial HTML loading screen until the workspace shell has committed. */
export function finishViewLoading(): void {
  document.getElementById('view-loading')?.remove();
}
