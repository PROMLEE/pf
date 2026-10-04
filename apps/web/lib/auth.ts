import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Kakao from "next-auth/providers/kakao";
import Naver from "next-auth/providers/naver";
import { db } from "./db";

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    Kakao({
      clientId: process.env.KAKAO_CLIENT_ID ?? "",
      clientSecret: process.env.KAKAO_CLIENT_SECRET ?? "",
    }),
    Naver({
      clientId: process.env.NAVER_CLIENT_ID ?? "",
      clientSecret: process.env.NAVER_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (!account?.providerAccountId) return token;
      const oauthProvider =
        account.provider === "kakao"
          ? "KAKAO"
          : account.provider === "naver"
            ? "NAVER"
            : null;
      if (!oauthProvider) return token;
      const oauthId = account.providerAccountId;
      const existing = await db().query<{
        userId: string;
        nickname: string;
        profileImageUrl: string | null;
      }>(
        `select "userId", nickname, "profileImageUrl" from public."User" where "oauthProvider" = $1 and "oauthId" = $2 limit 1`,
        [oauthProvider, oauthId],
      );
      let appUser = existing.rows[0];
      if (!appUser) {
        const id = `c${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
        const created = await db().query<typeof appUser>(
          `insert into public."User" ("userId", nickname, "profileImageUrl", "oauthProvider", "oauthId") values ($1,$2,$3,$4,$5) returning "userId", nickname, "profileImageUrl"`,
          [
            id,
            user.name ?? `user-${oauthId.slice(0, 6)}`,
            user.image ?? null,
            oauthProvider,
            oauthId,
          ],
        );
        appUser = created.rows[0];
      }
      token.appUserId = appUser.userId;
      token.name = appUser.nickname;
      token.picture = appUser.profileImageUrl;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.appUserId === "string") {
        session.user.appUserId = token.appUserId;
      }
      return session;
    },
  },
};

export async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.appUserId ?? null;
}
