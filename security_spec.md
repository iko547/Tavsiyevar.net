# Security Specification & Payload-First Verification (tavsiyevar.net)

## Data Invariants
1. Every document in `/recommendations/{recId}` must have `isPublic == true`, valid category enum, bounded field lengths, and non-PII `authorName` (never user emails).
2. Creating a recommendation requires `request.auth != null`, `email_verified == true`, `authorId == request.auth.uid`, and server timestamps `createdAt == request.time` / `updatedAt == request.time`.
3. Updating a recommendation is strictly partitioned into two actions:
   - Author/Admin edit: may only modify `['product', 'category', 'duration', 'note', 'media', 'updatedAt']`.
   - Community vote: may only modify `['ratingSum', 'ratingCount', 'updatedAt']` within strict single-vote delta bounds (`ratingCount` +0 or +1, `ratingSum` delta in `[-4, +5]`) AND must atomically write `/users/{request.auth.uid}/votes/{recId}` with matching `request.time`.
4. `/users/{userId}/votes/{recId}` is strictly isolated to `userId == request.auth.uid` for read, list, create, update, and delete.

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated recommendation creation (`request.auth == null`).
2. Unverified email trying to create a recommendation (`email_verified == false`).
3. Identity spoofing: setting `authorId` to another user's UID on create.
4. Shadow field injection: adding `isFeatured: true` or `adminOverride: true` to `/recommendations/{recId}`.
5. Oversized string poisoning: `note` > 2000 chars or `recId` > 128 chars or invalid chars in `recId`.
6. Invalid category injection: `category: "Otomobil"` outside enum allowlist.
7. Timestamp spoofing: setting `createdAt` or `updatedAt` to a client timestamp instead of `request.time`.
8. Non-author editing `product` or `note` on someone else's recommendation.
9. Rating manipulation without vote doc: incrementing `ratingSum` by `+500` directly on `/recommendations/{recId}` without atomic `/users/{uid}/votes/{recId}` write.
10. Cross-user vote tampering: writing `/users/{victimUid}/votes/{recId}` while signed in as attacker.
11. Out-of-bounds vote score: `score: 99` or `score: 0` in `/users/{uid}/votes/{recId}`.
12. Deleting another user's recommendation as a non-admin user.
