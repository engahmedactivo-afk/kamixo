/** Injection token for the global fetch, so network clients can be given a fake in tests. */
export const FETCH = Symbol('FETCH');
export const fetchProvider = { provide: FETCH, useValue: fetch };
