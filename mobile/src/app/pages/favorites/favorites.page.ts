import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
    IonAvatar,
    IonBadge, IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonItem, IonLabel,
    IonList,
    IonMenuButton,
    IonTitle,
    IonToolbar
} from '@ionic/angular/standalone';
import { AuthService } from 'src/app/core/services/auth.service';
import { FavLibroItem, FavoritesService } from 'src/app/core/services/favorites.service';
import { environment } from 'src/environments/environment';

@Component({
    standalone: true,
    selector: 'app-favorites',
    imports: [
        CommonModule, FormsModule,
        IonHeader, IonToolbar, IonTitle, IonContent,
        IonButtons, IonMenuButton, IonList, IonItem, IonLabel, IonBadge, IonButton, IonAvatar
    ],
    templateUrl: './favorites.page.html',
    styleUrls: ['./favorites.page.scss'],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class FavoritesPage implements OnInit {
    items: FavLibroItem[] = [];
    loading = false;
    meId: number | null = null;

    constructor(private favs: FavoritesService, private auth: AuthService, private router: Router) { }

    async ngOnInit() {
        await this.auth.restoreSession();
        this.meId = this.auth.user?.id ?? null;
        this.load();
    }

    load() {
        if (!this.meId) return;
        this.loading = true;
        this.favs.list(this.meId).subscribe({
            next: arr => { this.items = arr || []; this.loading = false; },
            error: () => { this.items = []; this.loading = false; }
        });
    }

    open(id: number) { this.router.navigate(['/books/view', id]); }

    remove(id: number) {
        if (!this.meId) return;
        this.favs.toggle(id, this.meId).subscribe(() => {
            this.items = this.items.filter(x => x.id !== id);
        });
    }
    private readonly fallbackPath = '/books/librodefecto.png';
    private readonly fallbackFull = this.abs(this.fallbackPath);

    // Normaliza rutas relativas/absolutas según tu backend
    private abs(url: string | null | undefined): string {
        const base = (environment.mediaBase || '').replace(/\/$/, '');
        if (!url) return `${base}${this.fallbackPath}`;
        if (/^https?:\/\//i.test(url)) return url;
        const path = url.startsWith('/') ? url : `/${url}`;
        return `${base}${path}`;
    }

    coverUrl(b: any): string {
        const raw = (b?.first_image || '').trim();
        return raw ? this.abs(raw) : this.fallbackFull;
    }

    onImgError(ev: Event) {
        const img = ev.target as HTMLImageElement;
        if (img?.src !== this.fallbackFull) img.src = this.fallbackFull; // evita loop
    }
}
