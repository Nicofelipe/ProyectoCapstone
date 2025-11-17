
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import ApiService from './api.service';

export interface FavLibroItem {
    id: number;
    titulo: string;
    autor?: string | null;
    disponible?: boolean;
    first_image?: string | null;
    owner_nombre?: string | null;
}

@Injectable({ providedIn: 'root' })
export class FavoritesService {
    constructor(private api: ApiService) { }

    list(userId: number): Observable<FavLibroItem[]> {
        return this.api.get<FavLibroItem[]>('/api/favoritos/', { params: { user_id: userId } });
    }

    // ✅ usa la ruta y clave correctas: favorited
    check(libroId: number, userId: number) {
        return this.api
            .get<{ favorited: boolean }>(`/api/favoritos/${libroId}/check/`, { params: { user_id: userId } })
            .pipe(map(r => !!r.favorited));
    }

    toggle(libroId: number, userId: number) {
        return this.api
            .post<{ favorited: boolean }>(`/api/favoritos/${libroId}/toggle/`, { user_id: userId })
            .pipe(map(r => !!r.favorited));
    }
}
