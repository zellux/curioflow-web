import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, isBlockedNetworkAddress } from "./outbound-http.ts";

test("outbound policy blocks private, loopback, metadata, and multicast addresses", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "224.0.0.1", "::1", "fd00::1"]) {
    assert.equal(isBlockedNetworkAddress(address), true, address);
    await assert.rejects(assertPublicHttpUrl(`http://[${address}]/`.replace("[127.0.0.1]", "127.0.0.1")));
  }
});

test("outbound policy rejects credentials and non-HTTP schemes", async () => {
  await assert.rejects(assertPublicHttpUrl("file:///etc/passwd"));
  await assert.rejects(assertPublicHttpUrl("https://user:password@93.184.216.34/"));
});
