import type { Account } from "@prisma/client";

export function canAddSource(_account: Account) {
  void _account;
  return true;
}

export function canUploadPdf(_account: Account, _fileSize: number) {
  void _account;
  void _fileSize;
  return true;
}

export function canRunAsk(_account: Account) {
  void _account;
  return true;
}

export function canGenerateBrief(_account: Account) {
  void _account;
  return true;
}
