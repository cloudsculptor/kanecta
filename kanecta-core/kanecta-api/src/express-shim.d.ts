// Ambient declaration for `express`. Express v5 ships no bundled type
// declarations and there is no @types/express in the workspace, so under the
// repo's strict/NodeNext tsconfig a bare `import express from 'express'` would
// fail with TS7016. This shim types the handful of Express surfaces the API
// uses; request/response/next are intentionally `any` (the routes read dynamic
// request data and were written untyped), which keeps handler callbacks
// contextually typed without annotating each one.
declare module 'express' {
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
  type Handler = (req: any, res: any, next?: any) => any;

  export interface Application {
    use(...handlers: any[]): Application;
    get(path: string, ...handlers: Handler[]): Application;
    post(path: string, ...handlers: Handler[]): Application;
    put(path: string, ...handlers: Handler[]): Application;
    patch(path: string, ...handlers: Handler[]): Application;
    delete(path: string, ...handlers: Handler[]): Application;
    listen(...args: any[]): any;
  }

  interface Express {
    (): Application;
    json(...args: any[]): any;
    urlencoded(...args: any[]): any;
    static(...args: any[]): any;
  }

  const express: Express;
  export default express;
}
