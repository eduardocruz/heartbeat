export async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const body = await response.json();
      detail = body.error || detail;
    } catch {
      // ignore malformed JSON response bodies
    }
    throw new Error(detail);
  }

  return response.status === 204 ? null : response.json();
}
