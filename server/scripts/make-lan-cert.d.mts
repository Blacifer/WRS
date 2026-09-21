/** Types for make-lan-cert.mjs, which the server imports to reissue its certificate when the address changes. */
export interface EnsureCertsResult {
  caMade: boolean;
  leafMade: boolean;
  ips: string[];
  dnsNames: string[];
  notAfter: Date | null;
  files: { caKeyPath: string; caCertPath: string; installPath: string; keyPath: string; certPath: string };
}
export function ensureCerts(outDir: string, extras?: string[]): EnsureCertsResult;
export function localIPv4s(): string[];
export function makeSelfSigned(opts: { commonName: string; organization: string; ips: string[]; dnsNames: string[]; days?: number }): { keyPem: string; certPem: string; certDer: Buffer; notAfter: Date; ips: string[]; dnsNames: string[] };
export function makeLeaf(opts: { caKeyPem: string; caCertDer: Buffer; commonName: string; organization: string; ips: string[]; dnsNames: string[]; days?: number }): { keyPem: string; certPem: string; certDer: Buffer; notAfter: Date; ips: string[]; dnsNames: string[] };
export function namesInCert(certPem: string): { ips: string[]; dnsNames: string[]; notAfter: Date; issuerIsSelf: boolean } | null;
