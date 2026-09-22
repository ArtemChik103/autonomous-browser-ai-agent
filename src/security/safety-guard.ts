export interface SecurityCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export class SafetyGuard {
  private userConstraints: string[] = [];

  setUserGoal(goal: string): void {
    this.userConstraints = [];
    const lower = goal.toLowerCase();

    if (lower.includes('не оплачивай') || lower.includes('без оплаты') || lower.includes('не плати')) {
      this.userConstraints.push('no_payment');
    }
    if (lower.includes('не удаляй') || lower.includes('без удаления')) {
      this.userConstraints.push('no_deletion');
    }
  }

  checkAction(toolName: string, args: Record<string, any>, contextText?: string): SecurityCheckResult {
    const selector = (args.selector || '').toLowerCase();
    const textVal = (args.text || '').toLowerCase();
    const context = (contextText || '').toLowerCase();
    const fullDesc = `${selector} ${textVal} ${context}`;

    // 1. Проверка ввода данных банковских карт или конфиденциальных платежных реквизитов
    const isCardData = /\b(?:\d[ -]*?){13,19}\b/.test(args.text || '') || /card|cvv|cvc|номер.карты|срок.действия/.test(fullDesc);
    if (toolName === 'type_text' && isCardData) {
      if (this.userConstraints.includes('no_payment')) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: 'Ввод реквизитов банковской карты заблокирован защитным слоем: действует ограничение «не оплачивай».'
        };
      }
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: 'Ввод реквизитов банковской карты требует подтверждения безопасности.'
      };
    }

    if (toolName !== 'click_element' && toolName !== 'type_text') {
      return { allowed: true, requiresConfirmation: false };
    }

    const isPaymentAction = /оплат|купить|оформить|checkout|pay|place.order/.test(fullDesc);
    const isDeleteAction = /удалить|delete|очистить|remove.all/.test(fullDesc);

    if (isPaymentAction) {
      if (this.userConstraints.includes('no_payment')) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: 'Оплата заблокирована защитным слоем (Security Layer): пользователь прямо указал «не оплачивай».'
        };
      }
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: 'Действие связано с финансовой транзакцией (оплата/заказ).'
      };
    }

    if (isDeleteAction) {
      if (this.userConstraints.includes('no_deletion')) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: 'Удаление заблокировано защитным слоем: пользователь указал «не удаляй».'
        };
      }
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: 'Деструктивное действие (удаление данных/писем).'
      };
    }

    return { allowed: true, requiresConfirmation: false };
  }
}
