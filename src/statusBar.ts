import * as vscode from 'vscode';
import { ChuckVm } from './chuckVm';

/** Status bar pill: VM on/off. */
export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor(
    private readonly vm: ChuckVm,
    private readonly version: string
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50
    );
    this.item.command = 'chuckLive.startVm';
    this.update(vm.running);
    vm.onStatusChange((on) => this.update(on));
    this.item.show();
  }

  private update(running: boolean): void {
    const ver = this.version ? ` ${this.version}` : '';
    if (running) {
      this.item.text = `$(broadcast) ChucK${ver}`;
      this.item.backgroundColor = undefined;
      this.item.command = 'chuckLive.stopVm';
      this.item.tooltip = `ChucK Live ${this.version} — VM running, click to stop`;
    } else {
      this.item.text = `$(circle-slash) ChucK${ver}`;
      this.item.tooltip = `ChucK Live ${this.version} — VM stopped, click to start`;
      this.item.command = 'chuckLive.startVm';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
