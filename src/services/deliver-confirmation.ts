export async function deliverConfirmation(actions: {
  send: () => Promise<string>;
  persist: (messageId: string) => Promise<void>;
  releaseClaim: () => Promise<void>;
}): Promise<void> {
  let messageId: string;

  try {
    messageId = await actions.send();
  } catch (error) {
    await actions.releaseClaim();
    throw error;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await actions.persist(messageId);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
