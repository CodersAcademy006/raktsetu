import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 does not catch a rejected promise from an async route handler --
// it becomes an unhandled rejection, which crashes the whole process (Node
// 15+ default). Every route in this app is async (Mongo/Gemma/Temporal
// calls), so every one of them is wrapped in this.
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
