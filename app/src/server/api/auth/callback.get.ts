import { defineEventHandler, sendRedirect } from 'h3';

// 旧コールバックへ戻ったブラウザーをログイン画面へ戻す。
export default defineEventHandler(event => sendRedirect(event, '/'));
