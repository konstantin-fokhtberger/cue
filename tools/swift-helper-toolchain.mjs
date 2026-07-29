import { access } from 'node:fs/promises';

const xcodeDeveloperDirectory = '/Applications/Xcode.app/Contents/Developer';

export async function swiftEnvironment() {
  if (process.env.DEVELOPER_DIR) {
    return process.env;
  }
  try {
    await access(xcodeDeveloperDirectory);
    return { ...process.env, DEVELOPER_DIR: xcodeDeveloperDirectory };
  } catch {
    return process.env;
  }
}
