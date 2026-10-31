export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime, e.g. "15m". */
  expiresIn: string;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    connectNumber: string;
  };
  tokens: AuthTokens;
}
