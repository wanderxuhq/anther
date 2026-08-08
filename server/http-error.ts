// server/http-error.ts
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// res.json 辅助（挂在原型上，路由层直接用）
import { ServerResponse } from 'node:http';
declare module 'node:http' {
  interface ServerResponse {
    json(data: unknown, status?: number): void;
  }
}
ServerResponse.prototype.json = function (data: unknown, status = 200) {
  const body = JSON.stringify(data);
  this.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  this.end(body);
};
