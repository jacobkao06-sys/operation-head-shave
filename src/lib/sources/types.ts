import type { Post, PostSource } from "../types";

export type { Post, PostSource };

export class SourceError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SourceError";
  }
}
