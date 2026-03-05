// NetworkManager stub for server-side (Deno) usage.
// The upstream livesync-lib expects this module; in browser environments it
// checks navigator.onLine.  For our headless bridge we always report online.

export interface NetworkManager {
	readonly isOnline: boolean;
}

export class NetworkManagerBrowser implements NetworkManager {
	get isOnline(): boolean {
		// In a browser this would check navigator.onLine.
		// Server-side: always online.
		return true;
	}
}
