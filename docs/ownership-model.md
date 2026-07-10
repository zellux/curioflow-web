# Ownership Model

Curioflow currently enforces one user principal per account.

Account-owned state includes libraries, item save/archive/read state, reading preferences, LLM settings, briefs, chats, subscriptions, usage, and account-specific enrichment. The sole user is the authentication principal for that account. Annotations retain a `userId` for authorship and future migration, but under the current invariant that user belongs to the same account as the item's library.

Provisioning must create a new account for every new user. The database enforces this with a unique constraint on `users.account_id`; tooling must not attach a second user to an existing account.

Multi-user accounts are not supported. Adding them later requires an explicit migration that introduces user-scoped item/reading/settings state and authorization rules before removing the uniqueness constraint. Code must not infer multi-user support from the retained account relations or `Annotation.userId`.
