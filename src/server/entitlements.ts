import type { Account } from "@prisma/client";

export function canAddSource(_account: Account) {
  return true;
}

export function canUploadPdf(_account: Account, _fileSize: number) {
  return true;
}

export function canRunAsk(_account: Account) {
  return true;
}

export function canGenerateBrief(_account: Account) {
  return true;
}
