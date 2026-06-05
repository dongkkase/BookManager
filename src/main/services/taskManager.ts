import { WebContents } from 'electron';
import { v4 as uuidv4 } from 'uuid';

/**
 * 태스크 진행률 정보
 */
export interface TaskProgress {
  taskId: string;
  percent: number;
  message: string;
  isFinished: boolean;
  isCancelled: boolean;
  result?: unknown;
}

/**
 * 태스크 상태
 */
export enum TaskState {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}

/**
 * 태스크 정보
 */
export interface TaskInfo {
  taskId: string;
  name: string;
  state: TaskState;
  percent: number;
  message: string;
  createdAt: number;
  finishedAt?: number;
  error?: string;
}

/**
 * 기본 태스크 클래스
 * 기존 Python의 WorkerSignals 기반 태스크 시스템 대응
 */
export abstract class BaseTask {
  public taskId: string;
  public name: string;
  protected webContents?: WebContents;
  protected _isCancelled = false;
  protected _isPaused = false;
  protected _percent = 0;
  protected _message = '';

  constructor(name: string, webContents?: WebContents) {
    this.taskId = uuidv4();
    this.name = name;
    this.webContents = webContents;
  }

  /**
   * 태스크 취소
   */
  public cancel(): void {
    this._isCancelled = true;
  }

  /**
   * 태스크 일시 정지
   */
  public pause(): void {
    this._isPaused = true;
  }

  /**
   * 태스크 재개
   */
  public resume(): void {
    this._isPaused = false;
  }

  /**
   * 취소 여부 확인
   */
  public get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * 일시 정지 여부 확인
   */
  public get isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * 진행률 업데이트
   */
  protected updateProgress(percent: number, message: string): void {
    this._percent = percent;
    this._message = message;
    this.sendProgress({
      taskId: this.taskId,
      percent,
      message,
      isFinished: false,
      isCancelled: this._isCancelled,
    });
  }

  /**
   * 태스크 완료
   */
  protected finish(message: string, result?: unknown): void {
    this._percent = 100;
    this._message = message;
    this.sendProgress({
      taskId: this.taskId,
      percent: 100,
      message,
      isFinished: true,
      isCancelled: this._isCancelled,
      result,
    });
  }

  /**
   * 에러 보고
   */
  protected error(message: string): void {
    this._message = message;
    this.sendProgress({
      taskId: this.taskId,
      percent: this._percent,
      message,
      isFinished: true,
      isCancelled: false,
    });
  }

  /**
   * 진행률 신호 전송
   */
  private sendProgress(progress: TaskProgress): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('task-progress', progress);
    }
  }

  /**
   * 일시 정지 대기
   */
  protected async waitForResume(): Promise<void> {
    while (this._isPaused && !this._isCancelled) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * 태스크 실행 (abstract)
   */
  public abstract run(): Promise<void>;
}

/**
 * 태스크 관리자
 * 태스크 큐, 병렬 처리, 취소/일시 정지 관리
 */
class TaskManager {
  private activeTasks: Map<string, BaseTask> = new Map();
  private taskQueue: BaseTask[] = [];
  private taskInfo: Map<string, TaskInfo> = new Map();
  private maxConcurrent: number;
  private runningCount = 0;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * 태스크 등록 및 실행
   */
  public async registerTask(task: BaseTask, webContents?: WebContents): Promise<string> {
    if (webContents) {
      // task의 webContents를 업데이트
      // webContents를 설정 (protected 속성이므로 직접 접근)
      Object.assign(task, { webContents });
    }

    // 태스크 정보 초기화
    this.taskInfo.set(task.taskId, {
      taskId: task.taskId,
      name: task.name,
      state: TaskState.PENDING,
      percent: 0,
      message: '대기 중...',
      createdAt: Date.now(),
    });

    // 즉시 실행 가능하면 실행, 아니면 큐에 추가
    if (this.runningCount < this.maxConcurrent) {
      await this.executeTask(task);
    } else {
      this.taskQueue.push(task);
    }

    return task.taskId;
  }

  /**
   * 태스크 실행
   */
  private async executeTask(task: BaseTask): Promise<void> {
    this.runningCount++;
    this.updateTaskState(task.taskId, TaskState.RUNNING, '실행 중...');

    try {
      await task.run();
      this.updateTaskState(task.taskId, TaskState.FINISHED, '완료', Date.now());
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.updateTaskState(task.taskId, TaskState.ERROR, `에러: ${errorMessage}`, Date.now());
      console.error(`Task ${task.taskId} failed:`, e);
    } finally {
      this.runningCount--;
      this.activeTasks.delete(task.taskId);
      this.processQueue();
    }
  }

  /**
   * 큐 처리
   */
  private async processQueue(): Promise<void> {
    while (this.taskQueue.length > 0 && this.runningCount < this.maxConcurrent) {
      const task = this.taskQueue.shift();
      if (task) {
        await this.executeTask(task);
      }
    }
  }

  /**
   * 태스크 취소
   */
  public cancelTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.cancel();
      this.updateTaskState(taskId, TaskState.CANCELLED, '취소됨');
      return true;
    }

    // 큐에서 제거 시도
    const queueIndex = this.taskQueue.findIndex((t) => t.taskId === taskId);
    if (queueIndex >= 0) {
      this.taskQueue.splice(queueIndex, 1);
      this.updateTaskState(taskId, TaskState.CANCELLED, '취소됨');
      return true;
    }

    return false;
  }

  /**
   * 태스크 일시 정지
   */
  public pauseTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.pause();
      this.updateTaskState(taskId, TaskState.PAUSED, '일시 정지됨');
      return true;
    }
    return false;
  }

  /**
   * 태스크 재개
   */
  public resumeTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.resume();
      this.updateTaskState(taskId, TaskState.RUNNING, '재개됨');
      return true;
    }
    return false;
  }

  /**
   * 태스크 정보 조회
   */
  public getTaskInfo(taskId: string): TaskInfo | undefined {
    return this.taskInfo.get(taskId);
  }

  /**
   * 모든 태스크 정보 조회
   */
  public getAllTaskInfo(): TaskInfo[] {
    return Array.from(this.taskInfo.values());
  }

  /**
   * 태스크 상태 업데이트
   */
  private updateTaskState(
    taskId: string,
    state: TaskState,
    message: string,
    finishedAt?: number
  ): void {
    const info = this.taskInfo.get(taskId);
    if (info) {
      info.state = state;
      info.message = message;
      if (finishedAt) {
        info.finishedAt = finishedAt;
      }
    }
  }

  /**
   * 최대 동시 태스크 수 설정
   */
  public setMaxConcurrent(count: number): void {
    this.maxConcurrent = Math.max(1, count);
    this.processQueue();
  }

  /**
   * 모든 태스크 취소
   */
  public cancelAll(): void {
    for (const [taskId] of this.activeTasks) {
      this.cancelTask(taskId);
    }
    this.taskQueue = [];
  }

  /**
   * 활성 태스크 수
   */
  public get activeCount(): number {
    return this.runningCount;
  }

  /**
   * 큐 대기 태스크 수
   */
  public get queueCount(): number {
    return this.taskQueue.length;
  }
}

// 싱글톤 인스턴스
export const taskManager = new TaskManager();
