import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { ChatService } from 'src/app/core/services/chat.service';

@Component({
  selector: 'app-chats-list',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, DatePipe],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
})
export class ListPage implements OnInit {
  loading = signal(true);
  items = signal<any[]>([]);
  meId?: number;

  constructor(
    private chats: ChatService,
    private auth: AuthService,
    private router: Router,
  ) { }

  async ngOnInit() {
    await this.auth.restoreSession();
    this.meId = this.auth.user?.id;
    if (!this.meId) { this.router.navigateByUrl('/auth/login'); return; }

    this.chats.listConversations(this.meId).subscribe({
      next: (rows) => this.items.set(rows || []),
      error: () => this.items.set([]),
      complete: () => this.loading.set(false),
    });
  }



  avatar(url?: string) { return url || '/assets/avatar.png'; }
  open(it: any) {
    const title = (it.counterpart_name || 'Chat')
      + (it.counterpart_book_title ? ` · ${it.counterpart_book_title}` : '');
    this.router.navigate(['/chats', it.id_conversacion], { state: { title } });
  }
}


