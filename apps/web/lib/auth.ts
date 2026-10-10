import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import { timingSafeEqual } from "node:crypto";
import Kakao from "next-auth/providers/kakao";
import Naver from "next-auth/providers/naver";
import Credentials from "next-auth/providers/credentials";
import { db } from "./db";
import { profileImageUrl } from "./profile-image";

const localAdminEnabled =
  process.env.NODE_ENV === "development" &&
  Boolean(
    process.env.LOCAL_ADMIN_USERNAME &&
      process.env.LOCAL_ADMIN_PASSWORD &&
      process.env.LOCAL_ADMIN_USER_ID,
  );

function matchesCredential(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

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
    ...(localAdminEnabled
      ? [
          Credentials({
            id: "local-admin",
            name: "Local QA Admin",
            credentials: {
              username: { label: "아이디", type: "text" },
              password: { label: "비밀번호", type: "password" },
            },
            async authorize(credentials, request) {
              const host = request.headers?.host ?? "";
              if (!/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(host))
                return null;
              if (
                !credentials?.username ||
                !credentials.password ||
                !matchesCredential(
                  credentials.username,
                  process.env.LOCAL_ADMIN_USERNAME!,
                ) ||
                !matchesCredential(
                  credentials.password,
                  process.env.LOCAL_ADMIN_PASSWORD!,
                )
              )
                return null;
              const userId = process.env.LOCAL_ADMIN_USER_ID!;
              const existing = await db().query<{ nickname: string }>(
                `select nickname from public."User" where "userId" = $1 and "oauthProvider" = 'GUEST' limit 1`,
                [userId],
              );
              return existing.rows[0]
                ? { id: userId, name: existing.rows[0].nickname }
                : null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account?.provider) token.loginProvider = account.provider;
      // Upgrade existing cookies once; normal session reads do not query the DB.
      if (!account && typeof token.appUserId === "string" && !token.profileImageChecked) {
        try {
          const result = await db().query<{ oauthProvider: string; profileImageUrl: string | null }>(
            `select "oauthProvider", "profileImageUrl" from public."User" where "userId" = $1 limit 1`,
            [token.appUserId],
          );
          const saved = result.rows[0];
          const provider = saved?.oauthProvider;
          token.loginProvider ??= provider === "NAVER" ? "naver" : provider === "KAKAO" ? "kakao" : provider === "GUEST" ? "local-admin" : "unknown";
          token.picture = profileImageUrl(saved?.profileImageUrl) ?? profileImageUrl(token.picture);
        } catch {
          // A display metadata lookup must not invalidate the authenticated session.
        }
        token.profileImageChecked = true;
      }
      if (account?.provider === "local-admin" && user?.id) {
        token.appUserId = user.id;
        token.name = user.name;
        token.profileImageChecked = true;
        return token;
      }
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
      const incomingImage = profileImageUrl(user.image);
      let appUser = existing.rows[0];
      if (!appUser) {
        const id = `c${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
        const created = await db().query<typeof appUser>(
          `insert into public."User" ("userId", nickname, "profileImageUrl", "oauthProvider", "oauthId") values ($1,$2,$3,$4,$5) returning "userId", nickname, "profileImageUrl"`,
          [
            id,
            user.name ?? `user-${oauthId.slice(0, 6)}`,
            incomingImage,
            oauthProvider,
            oauthId,
          ],
        );
        appUser = created.rows[0];
      }
      // Refresh an existing account's photo on successful OAuth login.
      if (incomingImage && incomingImage !== appUser.profileImageUrl) {
        try {
          await db().query(
            `update public."User" set "profileImageUrl" = $1 where "userId" = $2 and "oauthProvider" = $3 and "oauthId" = $4`,
            [incomingImage, appUser.userId, oauthProvider, oauthId],
          );
        } catch {
          // Photo persistence failure must not prevent login.
        }
      }
      token.appUserId = appUser.userId;
      token.name = appUser.nickname;
      token.picture = incomingImage ?? profileImageUrl(appUser.profileImageUrl);
      token.profileImageChecked = true;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.appUserId === "string") {
        session.user.appUserId = token.appUserId;
        session.user.loginProvider = token.loginProvider;
        session.user.image = profileImageUrl(token.picture);
      }
      return session;
    },
  },
};

export async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.appUserId ?? null;
}
