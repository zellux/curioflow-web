export function documentVisibleToAccount(
  document: { ownerAccountId: string | null } | null | undefined,
  accountId: string
) {
  return !document?.ownerAccountId || document.ownerAccountId === accountId;
}

export function accountDocumentOwnershipWhere(accountId: string) {
  return { OR: [{ ownerAccountId: null }, { ownerAccountId: accountId }] };
}
