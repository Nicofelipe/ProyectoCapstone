// src/app/pages/chats/list/list.page.ts
import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { ChatService, ConversationSummary } from 'src/app/core/services/chat.service';

@Component({
  selector: 'app-chats-list',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, DatePipe],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
})
export class ListPage implements OnInit {
  loading = signal(true);
  items = signal<ConversationSummary[]>([]);
  meId?: number;

  // 👇 pestaña seleccionada: 'activos' | 'archivados'
  segment = signal<'activos' | 'archivados'>('activos');

  // 👇 lista filtrada según la pestaña
  filtered = computed(() => {
    const tab = this.segment();
    const rows = this.items() || [];
    return rows.filter(c => {
      const arch = !!c.archivado;
      return tab === 'activos' ? !arch : arch;
    });
  });

  constructor(
    private chats: ChatService,
    private auth: AuthService,
    private router: Router,
  ) {}

  async ngOnInit() {
    await this.auth.restoreSession();
    this.meId = this.auth.user?.id;
    if (!this.meId) {
      this.router.navigateByUrl('/auth/login');
      return;
    }

    this.loading.set(true);
    this.chats.listConversations(this.meId).subscribe({
      next: (rows) => this.items.set(rows || []),
      error: () => this.items.set([]),
      complete: () => this.loading.set(false),
    });
  }

  // llamado desde <ion-refresher> para recargar
  async reload() {
    await this.ngOnInit();
  }

  changeTab(ev: any) {
    const val = (ev.detail?.value || 'activos') as 'activos' | 'archivados';
    this.segment.set(val);
  }

  avatar(url?: string | null): string {
  return url || '/avatars/avatardefecto.jpg';
}

  open(it: ConversationSummary) {
    const title =
      (it.counterpart_name || 'Chat') +
      (it.counterpart_book_title ? ` · ${it.counterpart_book_title}` : '');
    this.router.navigate(['/chats', it.id_conversacion], { state: { title } });
  }
}
