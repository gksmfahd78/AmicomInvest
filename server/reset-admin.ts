import "dotenv/config";
import { Store, hashPassword } from "./db";
const password = process.env.NEW_ADMIN_PASSWORD;
if (!password || password.length < 12 || password.length > 128)
  throw Error("NEW_ADMIN_PASSWORD를 12~128자로 설정하세요.");
const store = new Store(process.env.DATABASE_PATH || "./data/study.sqlite");
const admin = store.db
  .prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")
  .get();
if (!admin) throw Error("관리자가 없습니다.");
store.transaction(() => {
  store.db
    .prepare("UPDATE users SET password=? WHERE id=?")
    .run(hashPassword(password), admin.id!);
  store.db.prepare("DELETE FROM sessions WHERE user_id=?").run(admin.id!);
});
store.db.close();
console.log("관리자 비밀번호를 변경하고 기존 세션을 해제했습니다.");
