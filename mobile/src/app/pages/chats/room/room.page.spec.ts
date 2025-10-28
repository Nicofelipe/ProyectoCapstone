import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { RoomPage } from './room.page';

describe('RoomPage', () => {
  let component: RoomPage;
  let fixture: ComponentFixture<RoomPage>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [RoomPage],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
