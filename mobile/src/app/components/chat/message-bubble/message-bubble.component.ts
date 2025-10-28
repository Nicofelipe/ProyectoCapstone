import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ChatMessage } from 'src/app/core/services/chat.service';

@Component({
  selector: 'app-message-bubble',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
  <div class="row" [class.mine]="mine">
    <div class="bubble">
      <div class="text">{{ msg.cuerpo }}</div>
      <div class="meta">{{ msg.enviado_en | date:'shortTime' }}</div>
    </div>
  </div>
  `,
  styles: [`
  .row{display:flex;margin:6px 10px}
  .row.mine{justify-content:flex-end}
  .bubble{
    max-width:76%;
    padding:10px 12px;
    border-radius:14px;
    background:#fff;
    box-shadow:0 1px 2px rgba(0,0,0,.08);
  }
  .row.mine .bubble{ background:#e7dbdb; }
  .text{ white-space:pre-wrap; word-break:break-word; }
  .meta{ font-size:11px; opacity:.6; margin-top:4px; text-align:right;}
  `]
})
export class MessageBubbleComponent {
  @Input() meId = 0;
  @Input() msg!: ChatMessage;

  get mine() { return this.msg?.id_usuario_emisor === this.meId; }
}
