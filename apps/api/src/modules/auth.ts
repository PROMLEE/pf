import { randomUUID } from "node:crypto";

type DemoUser = {
  id: string;
  email: string;
  password: string;
  displayName: string;
};

type SessionRecord = {
  userId: string;
  expiresAt: string;
};

const users = [
  {
    id: "user-demo",
    email: "demo@portfolio.local",
    password: "demo1234",
    displayName: "Demo User"
  }
] as DemoUser[];

const sessions = new Map<string, SessionRecord>();

export function login(email: string, password: string) {
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) return null;

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
  sessions.set(token, { userId: user.id, expiresAt });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName
    },
    expiresAt
  };
}

export function getSession(token: string | undefined) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}
