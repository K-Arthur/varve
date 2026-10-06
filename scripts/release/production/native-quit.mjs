// WebKit can lose the click response when the native Quit action destroys its
// webview. Accept only that specific terminal click response, and only after
// the independently observed native process actually exits. Other errors fail.
export async function clickAndWaitForNativeExit(click, waitForExit) {
  let closedResponse = null;
  try {
    await click();
  } catch (error) {
    if (
      !/WebDriverError: (?:unknown error|no such window|invalid session id|session deleted because of page crash or hang\.) when running "element\/[^"\n]+\/click"/.test(
        error.message,
      )
    )
      throw error;
    closedResponse = error.message;
  }
  await waitForExit();
  return closedResponse;
}
