import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { ComposerComponent } from 'src/app/components/chat/composer/composer.component';
import { MessageBubbleComponent } from 'src/app/components/chat/message-bubble/message-bubble.component';
import { AuthService } from 'src/app/core/services/auth.service';
import { ChatMessage, ChatService } from 'src/app/core/services/chat.service';
import { RealtimeService } from 'src/app/core/services/realtime.service';

@Component({
  selector: 'app-chat-room',
  standalone: true,
  imports: [CommonModule, IonicModule, ComposerComponent, MessageBubbleComponent],
  templateUrl: './room.page.html',
  styleUrls: ['./room.page.scss'],
})
export class RoomPage implements OnInit, OnDestroy {
  chatId = 0;
  title = 'Chat';
  meId = 0;

  loading = signal(true);
  messages = signal<ChatMessage[]>([]);
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private rt: RealtimeService,
    private chat: ChatService,
    private auth: AuthService,
  ) { }

  async ngOnInit() {
    await this.auth.restoreSession();
    this.meId = this.auth.user?.id ?? 0;

    this.chatId = Number(this.route.snapshot.paramMap.get('id') ?? 0);
    // título desde history.state si viene
    const st = history.state as any;
    if (st?.title) this.title = st.title;

    if (!this.chatId) return;

    this.sub = this.rt.watchConversation(this.chatId).subscribe(list => {
      this.messages.set(list);
      this.loading.set(false);
      const last = list.length ? list[list.length - 1].id_mensaje : 0;
      if (last) this.chat.markSeen(this.chatId, this.meId).subscribe();
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  async onSend(text: string) {
    if (!text?.trim()) return;
    await this.chat.sendMessage(this.chatId, text.trim(), this.meId).toPromise(); // 👈 pasa meId
  }
}
