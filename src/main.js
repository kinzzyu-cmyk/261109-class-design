import './style.css'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_MODEL = 'gpt-4.1-mini'

const rawApiKey = import.meta.env.VITE_OPENAI_API_KEY
const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : ''

function hasConfiguredKey(key) {
  return Boolean(
    key &&
      key !== 'your_openai_api_key_here' &&
      key !== 'sk-proj-your_openai_api_key_here'
  )
}

/**
 * 대화 내역 저장 배열
 * 각 항목은 { role: 'user' | 'assistant', content: string } 형태이며,
 * 이어지는 질문에 답할 수 있도록 매 요청의 input 파라미터에 전체 대화 흐름을 전달합니다.
 */
let conversationHistory = []
let isLoading = false

const appRoot = document.querySelector('#app')

appRoot.innerHTML = `
  <main class="chat-shell">
    <header class="chat-header">
      <div class="header-top">
        <div class="brand-group">
          <h1 class="app-title">OpenAI Responses API 챗봇</h1>
          <span class="model-tag" title="사용 모델">${OPENAI_MODEL}</span>
        </div>
        <div class="header-controls">
          <div id="api-status-badge" class="status-badge" data-status="missing" role="status" aria-live="polite">
            <span class="status-dot" aria-hidden="true"></span>
            <span id="api-status-label">키 미설정</span>
          </div>
          <button id="reset-btn" type="button" class="btn btn-outline">
            대화 초기화
          </button>
        </div>
      </div>
      <div id="api-status-bar" class="status-bar" data-status="missing">
        <span id="api-status-detail"></span>
        <span id="turn-counter" class="turn-counter">대화 0턴</span>
      </div>
    </header>

    <section id="chat-messages" class="chat-messages" aria-live="polite"></section>

    <footer class="chat-footer">
      <form id="chat-form" class="chat-form">
        <textarea
          id="chat-input"
          class="chat-input"
          rows="1"
          placeholder="메시지를 입력하세요 (Enter: 전송, Shift+Enter: 줄바꿈)"
          aria-label="메시지 입력"
        ></textarea>
        <button id="send-btn" type="submit" class="btn btn-primary">
          전송
        </button>
      </form>
      <p class="security-notice">
        <span>교육용 실습: 브라우저에서 직접 <code>POST /v1/responses</code>를 호출합니다.</span>
        <span>주의: <code>VITE_*</code> 환경 변수는 브라우저에 노출되므로 공개 배포 금지</span>
      </p>
    </footer>
  </main>
`

const statusBadgeEl = document.querySelector('#api-status-badge')
const statusLabelEl = document.querySelector('#api-status-label')
const statusBarEl = document.querySelector('#api-status-bar')
const statusDetailEl = document.querySelector('#api-status-detail')
const turnCounterEl = document.querySelector('#turn-counter')
const messagesContainerEl = document.querySelector('#chat-messages')
const chatFormEl = document.querySelector('#chat-form')
const chatInputEl = document.querySelector('#chat-input')
const sendBtnEl = document.querySelector('#send-btn')
const resetBtnEl = document.querySelector('#reset-btn')

/**
 * API 상태 UI 업데이트
 * - 'missing'    : 키 미설정
 * - 'unverified' : 연결 미확인 (키가 있지만 아직 실제 API 요청 전)
 * - 'success'    : 요청 성공 (실제 Responses API 응답 수신 완료)
 * - 'error'      : 요청 실패 (이해하기 쉬운 실패 원인 안내)
 */
function updateApiStatus(state, customMessage = '') {
  statusBadgeEl.dataset.status = state
  statusBarEl.dataset.status = state

  if (state === 'missing') {
    statusLabelEl.textContent = '키 미설정'
    statusDetailEl.innerHTML =
      customMessage ||
      '프로젝트 루트의 <code>.env.local</code> 파일에 <code>VITE_OPENAI_API_KEY</code>를 입력한 뒤 개발 서버를 재시작해 주세요.'
    return
  }

  if (state === 'unverified') {
    statusLabelEl.textContent = '연결 미확인'
    statusDetailEl.innerHTML =
      customMessage ||
      '환경 변수에 API Key가 설정되어 있습니다. 메시지를 보내 실제 Responses API 연결 여부를 확인하세요.'
    return
  }

  if (state === 'success') {
    statusLabelEl.textContent = '요청 성공'
    statusDetailEl.innerHTML =
      customMessage ||
      `OpenAI Responses API (<code>${OPENAI_MODEL}</code>) 요청이 정상적으로 처리되었습니다.`
    return
  }

  if (state === 'error') {
    statusLabelEl.textContent = '요청 실패'
    statusDetailEl.textContent =
      customMessage ||
      'API 요청 처리 중 오류가 발생했습니다. 설정과 네트워크 상태를 확인해 주세요.'
  }
}

/**
 * 대화 턴 수 표시 업데이트
 */
function updateTurnCounter() {
  const userTurnCount = conversationHistory.filter((item) => item.role === 'user').length
  turnCounterEl.textContent = `대화 ${userTurnCount}턴`
}

/**
 * 빈 대화 화면(초기 안내) 렌더링
 */
function renderEmptyState() {
  messagesContainerEl.innerHTML = `
    <div class="empty-state">
      <p class="empty-state-title">대화를 시작해 보세요</p>
      <p class="empty-state-desc">
        입력한 메시지와 이전 대화 맥락이 함께 OpenAI Responses API로 전송되어 이어지는 질문에도 답변할 수 있습니다.
      </p>
      <div class="empty-state-meta">
        <div>• 엔드포인트: <code>POST https://api.openai.com/v1/responses</code></div>
        <div>• 사용 모델: <code>${OPENAI_MODEL}</code></div>
        <div>• 문맥 유지: <code>input</code> 배열에 현재 대화 내역 전달</div>
      </div>
    </div>
  `
}

/**
 * 화면에 단일 메시지 말풍선 추가
 */
function appendMessageElement(role, text, isError = false) {
  const emptyStateEl = messagesContainerEl.querySelector('.empty-state')
  if (emptyStateEl) {
    emptyStateEl.remove()
  }

  const rowEl = document.createElement('div')
  rowEl.className = `message-row ${role}${isError ? ' error-message' : ''}`

  const roleLabelEl = document.createElement('span')
  roleLabelEl.className = 'message-role'
  roleLabelEl.textContent = role === 'user' ? '나 (User)' : isError ? '안내 (System)' : '챗봇 (Assistant)'

  const bubbleEl = document.createElement('div')
  bubbleEl.className = 'message-bubble'
  bubbleEl.textContent = text

  rowEl.appendChild(roleLabelEl)
  rowEl.appendChild(bubbleEl)
  messagesContainerEl.appendChild(rowEl)
  scrollToBottom()

  return rowEl
}

/**
 * 로딩 말풍선 표시 및 제거
 */
function showLoadingIndicator() {
  const emptyStateEl = messagesContainerEl.querySelector('.empty-state')
  if (emptyStateEl) {
    emptyStateEl.remove()
  }

  const rowEl = document.createElement('div')
  rowEl.id = 'loading-indicator-row'
  rowEl.className = 'message-row assistant'

  const roleLabelEl = document.createElement('span')
  roleLabelEl.className = 'message-role'
  roleLabelEl.textContent = '챗봇 (Assistant)'

  const bubbleEl = document.createElement('div')
  bubbleEl.className = 'message-bubble loading-bubble'
  bubbleEl.innerHTML = `
    <span>응답을 기다리는 중입니다</span>
    <span class="loading-dots" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
  `

  rowEl.appendChild(roleLabelEl)
  rowEl.appendChild(bubbleEl)
  messagesContainerEl.appendChild(rowEl)
  scrollToBottom()
}

function removeLoadingIndicator() {
  const loadingRow = document.querySelector('#loading-indicator-row')
  if (loadingRow) {
    loadingRow.remove()
  }
}

function scrollToBottom() {
  messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight
}

/**
 * 로딩 중 중복 전송 방지 및 입력창 상태 제어
 */
function setLoadingState(loading) {
  isLoading = loading
  sendBtnEl.disabled = loading
  resetBtnEl.disabled = loading
  chatInputEl.disabled = loading
  sendBtnEl.textContent = loading ? '응답 대기 중...' : '전송'
}

/**
 * OpenAI Responses API 응답 객체에서 출력 텍스트 추출
 * 공식 문서 기준 REST 응답의 output 배열 내 message -> content -> output_text.text를 순회하며,
 * SDK 호환 프로퍼티인 output_text도 함께 지원합니다.
 */
function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim().length > 0) {
    return data.output_text.trim()
  }

  if (Array.isArray(data?.output)) {
    const collectedTexts = []

    for (const item of data.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const contentPart of item.content) {
          if (
            (contentPart?.type === 'output_text' || contentPart?.type === 'text') &&
            typeof contentPart.text === 'string'
          ) {
            collectedTexts.push(contentPart.text)
          }
        }
      }
    }

    if (collectedTexts.length > 0) {
      return collectedTexts.join('\n').trim()
    }
  }

  throw new Error('응답 데이터에서 텍스트 결과를 찾을 수 없습니다.')
}

/**
 * HTTP 상태 코드 및 OpenAI 에러 코드에 따라 이해하기 쉬운 한국어 안내 문구 생성
 */
function getFriendlyErrorMessage(status, errorPayload) {
  const errorObj = errorPayload?.error
  const errorCode = errorObj?.code || ''
  const apiMessage = errorObj?.message || ''

  if (status === 401) {
    return 'API Key가 유효하지 않습니다 (401). .env.local 파일의 VITE_OPENAI_API_KEY 값이 정확한지 확인하고 개발 서버를 재시작해 주세요.'
  }

  if (status === 429) {
    if (errorCode === 'insufficient_quota') {
      return 'OpenAI 계정의 크레딧(결제 한도)이 부족합니다 (429 insufficient_quota). OpenAI Platform의 Billing 설정을 확인해 주세요.'
    }
    return '짧은 시간에 요청이 많이 발생하여 속도 제한에 도달했습니다 (429). 잠시 후 다시 시도해 주세요.'
  }

  if (status === 403) {
    return `현재 API Key로 ${OPENAI_MODEL} 모델 또는 리소스에 접근할 권한이 없습니다 (403). 프로젝트 권한 설정을 확인해 주세요.`
  }

  if (status === 404) {
    return `요청한 엔드포인트 또는 모델(${OPENAI_MODEL})을 찾을 수 없습니다 (404).`
  }

  if (status === 400) {
    return `요청 형식이 올바르지 않습니다 (400). ${apiMessage ? `상세 사유: ${apiMessage}` : ''}`
  }

  if (status >= 500) {
    return `OpenAI 서버에 일시적인 오류가 발생했습니다 (${status}). 잠시 후 다시 시도해 주세요.`
  }

  return `API 요청이 실패했습니다 (${status}). ${apiMessage || '설정을 다시 확인해 주세요.'}`
}

/**
 * 메시지 전송 처리
 */
async function handleSendMessage(event) {
  event.preventDefault()

  // 로딩 중 중복 전송 방지
  if (isLoading) {
    return
  }

  const userText = chatInputEl.value.trim()
  if (!userText) {
    return
  }

  // 키 미설정 상태 확인
  if (!hasConfiguredKey(apiKey)) {
    updateApiStatus(
      'missing',
      'API Key가 설정되지 않아 요청을 보낼 수 없습니다. <code>.env.local</code> 파일에 <code>VITE_OPENAI_API_KEY</code>를 입력한 뒤 개발 서버를 재시작해 주세요.'
    )
    appendMessageElement(
      'assistant',
      'API Key가 설정되어 있지 않습니다. 프로젝트 루트의 .env.local 파일에 VITE_OPENAI_API_KEY를 입력하고 개발 서버(npm run dev)를 재시작한 뒤 다시 시도해 주세요.',
      true
    )
    return
  }

  // 입력창 비우기 및 높이 초기화
  chatInputEl.value = ''
  chatInputEl.style.height = 'auto'

  // 화면에 사용자 메시지 표시
  appendMessageElement('user', userText)

  // 이어지는 질문에 답할 수 있도록 이전 대화 내역 + 현재 사용자 메시지를 함께 구성
  const requestInput = [
    ...conversationHistory.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    {
      role: 'user',
      content: userText,
    },
  ]

  setLoadingState(true)
  showLoadingIndicator()

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: requestInput,
      }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const friendlyReason = getFriendlyErrorMessage(response.status, data)
      removeLoadingIndicator()
      updateApiStatus('error', friendlyReason)
      appendMessageElement('assistant', friendlyReason, true)
      return
    }

    const assistantReply = extractResponseText(data)
    removeLoadingIndicator()

    // 요청이 성공했을 때만 대화 내역에 현재 턴(사용자 질문 + 챗봇 답변)을 반영
    conversationHistory.push(
      { role: 'user', content: userText },
      { role: 'assistant', content: assistantReply }
    )

    updateTurnCounter()
    updateApiStatus('success')
    appendMessageElement('assistant', assistantReply)
  } catch (error) {
    removeLoadingIndicator()
    const networkReason =
      error instanceof TypeError
        ? '네트워크 연결 오류가 발생했습니다. 인터넷 연결 상태를 확인하거나 브라우저 확장 프로그램(광고 차단기 등)이 api.openai.com 요청을 차단하고 있지 않은지 확인해 주세요.'
        : error?.message || '알 수 없는 오류로 요청에 실패했습니다.'

    updateApiStatus('error', networkReason)
    appendMessageElement('assistant', networkReason, true)
  } finally {
    setLoadingState(false)
    chatInputEl.focus()
  }
}

/**
 * 대화 초기화 처리
 */
function handleResetConversation() {
  if (isLoading) {
    return
  }

  conversationHistory = []
  updateTurnCounter()
  renderEmptyState()
  chatInputEl.value = ''
  chatInputEl.style.height = 'auto'
  chatInputEl.focus()
}

// 입력창 자동 높이 조절 및 Enter 전송 (Shift+Enter는 줄바꿈)
chatInputEl.addEventListener('input', () => {
  chatInputEl.style.height = 'auto'
  chatInputEl.style.height = `${Math.min(chatInputEl.scrollHeight, 140)}px`
})

chatInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (!isLoading) {
      chatFormEl.requestSubmit()
    }
  }
})

chatFormEl.addEventListener('submit', handleSendMessage)
resetBtnEl.addEventListener('click', handleResetConversation)

// 초기 렌더링: 키 유무에 따라 '키 미설정' 또는 '연결 미확인' 표시
if (hasConfiguredKey(apiKey)) {
  updateApiStatus('unverified')
} else {
  updateApiStatus('missing')
}

updateTurnCounter()
renderEmptyState()
