import Link from "next/link";
import { currentUserId } from "../../lib/auth";
import { isAdmin } from "../../lib/admin";
import AdminConsole from "./AdminConsole";
export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const user = await currentUserId();
  if (!(await isAdmin(user)))
    return (
      <main style={{ maxWidth: 640, margin: "80px auto", padding: 24 }}>
        <h1>관리자 전용 화면입니다.</h1>
        <p>
          {user
            ? "이 계정에는 운영 권한이 없습니다."
            : "관리자 계정으로 로그인해 주세요."}
        </p>
        <Link href="/">PortRhythm으로 돌아가기</Link>
      </main>
    );
  return <AdminConsole />;
}
