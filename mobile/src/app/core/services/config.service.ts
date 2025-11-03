import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';

export interface AppConfig {
    mapsApiKey: string;
    apiBase: string;
}

type Env = typeof environment & { apiBase?: string; apiUrl?: string };


@Injectable({ providedIn: 'root' })
export class ConfigService {
    private cfg?: AppConfig;

    async load(): Promise<void> {
        if (this.cfg) return; // idempotente

        const env = environment as Env;
        const baseRaw = env.apiBase ?? env.apiUrl ?? '';
        const base = baseRaw.replace(/\/$/, ''); // quita slash final


        const res = await fetch(`${base}/api/public/config`);
        if (!res.ok) throw new Error('No se pudo obtener /api/public/config');
        this.cfg = await res.json();
    }

    get config(): AppConfig {
        if (!this.cfg) throw new Error('Config no cargada');
        return this.cfg;
    }
}
