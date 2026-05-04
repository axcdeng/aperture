// Discord snowflake helpers. Snowflakes encode ms-since-Discord-epoch in the
// upper 42 bits, so we can convert between a Date and a snowflake without
// hitting the API.

const DISCORD_EPOCH = 1420070400000n;

export function snowflakeToDate(snowflake: string): Date {
  const ms = (BigInt(snowflake) >> 22n) + DISCORD_EPOCH;
  return new Date(Number(ms));
}

export function dateToSnowflake(date: Date): string {
  const ms = BigInt(date.getTime()) - DISCORD_EPOCH;
  if (ms < 0n) return '0';
  return (ms << 22n).toString();
}
