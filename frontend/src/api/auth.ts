import client from './client';

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/api/auth/login', {
    username,
    password,
  });
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  return data;
}

export async function refresh(): Promise<AuthResponse> {
  const refreshToken = localStorage.getItem('refreshToken');
  const { data } = await client.post<AuthResponse>('/api/auth/refresh', {
    refreshToken,
  });
  localStorage.setItem('accessToken', data.accessToken);
  if (data.refreshToken) {
    localStorage.setItem('refreshToken', data.refreshToken);
  }
  return data;
}

export async function logout(): Promise<void> {
  try {
    await client.post('/api/auth/logout');
  } finally {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }
}

export async function getMe(): Promise<User> {
  const { data } = await client.get<{ user: User }>('/api/auth/me');
  return data.user;
}
