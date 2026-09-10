process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3099';
process.env.DATABASE_URL ??=
  'postgresql://raiquid:raiquid@127.0.0.1:5544/raiquid?schema=public';
process.env.CLERK_SECRET_KEY ??= 'sk_test_e2e_dummy';
process.env.CLERK_PUBLISHABLE_KEY ??= 'pk_test_e2e_dummy';
process.env.CLERK_WEBHOOK_SECRET ??= 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
process.env.FRONTEND_URL ??= 'http://localhost:3000';
process.env.R2_ACCOUNT_ID ??= 'e2e-dummy-account';
process.env.R2_ACCESS_KEY_ID ??= 'e2e-dummy-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'e2e-dummy-secret';
process.env.R2_BUCKET_NAME ??= 'e2e-dummy-bucket';
process.env.RESEND_API_KEY ??= 're_e2e_dummy';
process.env.BRICKKEN_API_KEY ??= 'bk_e2e_dummy';
process.env.BRICKKEN_PRIVATE_KEY ??=
  '0x0000000000000000000000000000000000000000000000000000000000000001';
process.env.BRICKKEN_TOKENIZER_EMAIL ??= 'tokenizer-e2e@raiquid.test';
process.env.BRICKKEN_ACCEPTED_COIN ??=
  '0x0000000000000000000000000000000000000000';
