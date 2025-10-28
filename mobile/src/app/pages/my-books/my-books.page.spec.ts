import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyBooksPage } from './my-books.page';

describe('MyBooksPage', () => {
  let component: MyBooksPage;
  let fixture: ComponentFixture<MyBooksPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MyBooksPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
