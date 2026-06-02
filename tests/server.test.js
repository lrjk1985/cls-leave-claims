const test = require("node:test");
const assert = require("node:assert/strict");
const { __test } = require("../server");

test("parseMultipartBuffer keeps receipt uploads binary", () => {
  const boundary = "----cls-leave-claims-test";
  const receiptBytes = Buffer.from("%PDF-1.4\nbinary\u0000receipt-data\n", "utf8");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nMedical\r\n`, "utf8"),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      "utf8"
    ),
    receiptBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  ]);

  const parsed = __test.parseMultipartBuffer(body, boundary);
  assert.equal(parsed.category, "Medical");
  assert.equal(parsed.receipt.name, "receipt.pdf");
  assert.equal(parsed.receipt.type, "application/pdf");
  assert.deepEqual(parsed.receipt.buffer, receiptBytes);

  const receipt = __test.parseReceipt(parsed.receipt);
  assert.equal(receipt.originalName, "receipt.pdf");
  assert.equal(receipt.mimeType, "application/pdf");
  assert.deepEqual(receipt.buffer, receiptBytes);
});

test("receiptUploadMetadata falls back to file extension when browser MIME is missing", () => {
  const metadata = __test.receiptUploadMetadata({
    name: "receipt.jpg",
    type: "application/octet-stream",
    size: 1024
  });

  assert.equal(metadata.mimeType, "image/jpeg");
  assert.equal(metadata.extension, ".jpg");
});

test("resolveSupabaseSignedUrl builds a browser upload URL from a token", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  try {
    const endpoint = __test.storageObjectEndpoint("claim-receipts", "pending/user-1/receipt.pdf", "object/upload/sign");
    const signedUrl = __test.resolveSupabaseSignedUrl("", "upload-token", endpoint);
    assert.equal(
      signedUrl,
      "https://example.supabase.co/storage/v1/object/upload/sign/claim-receipts/pending/user-1/receipt.pdf?token=upload-token"
    );
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("resetEmployeePassword sets a new temporary password", () => {
  const db = {
    users: [
      {
        id: "usr_1",
        email: "employee@cls.local",
        name: "Employee",
        active: true
      }
    ]
  };

  const { employee, temporaryPassword } = __test.resetEmployeePassword(db, "usr_1", {
    password: "welcome123"
  });

  assert.equal(temporaryPassword, "welcome123");
  assert.equal(employee.updatedAt.includes("T"), true);
  assert.equal(__test.verifyPassword("welcome123", employee), true);
  assert.throws(
    () => __test.resetEmployeePassword(db, "usr_1", { password: "short" }),
    /Temporary password must be at least 8 characters/
  );
});
