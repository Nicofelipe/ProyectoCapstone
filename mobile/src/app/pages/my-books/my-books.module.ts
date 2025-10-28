import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { MyBooksPage } from './my-books.page';

@NgModule({
  // 👇 QUITA declarations
  // declarations: [MyBooksPage],
  imports: [
    CommonModule,
    IonicModule,
    // Importa el standalone
    MyBooksPage,
    RouterModule.forChild([{ path: '', component: MyBooksPage }]),
  ],
})
export class MyBooksPageModule {}
