'use client';
// import Image from "next/image";
import clsx from "clsx";
import { debounce } from 'lodash';
import { useEffect, useRef, useState } from "react";
import { useChatRecordStore, ChatRole, ChatMessage, useAgentEngineSettingsStore, useAgentModeStore, useMuteStore, useInteractionModeStore, InteractionMode, useAudioAutoStopStore } from "@/app/lib/store";
import { ConfirmAlert } from "@/app/ui/common/alert";
import { AUDIO_SUPPORT_ALERT, AI_THINK_MESSAGE } from "@/app/lib/constants";
import { Comm } from "@/app/lib/comm";
import { CharacterManager } from "@/app/lib/character";
import Recorder from 'js-audio-recorder';
import Markdown from 'react-markdown';

let micRecorder: Recorder | null = null;
let isRecording: boolean = false;

// Add this outside the component to persist across renders
const speakerNameCache = new Map<number, string>();

export default function Chatbot(props: { showChatHistory: boolean }) {
    const { showChatHistory } = props;
    const { chatRecord, addChatRecord, updateLastRecord, clearChatRecord } = useChatRecordStore();
    const { mute } = useMuteStore();
    const { agentEngine } = useAgentModeStore();
    const { mode } = useInteractionModeStore();
    const { agentSettings } = useAgentEngineSettingsStore();
    const { audioAutoStop } = useAudioAutoStopStore();
    const [settings, setSettings] = useState<{ [key: string]: string }>({});
    const [conversationId, setConversationId] = useState("");
    const [micRecording, setMicRecording] = useState(false);
    const [micRecordAlert, setmicRecordAlert] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const chatbotRef = useRef<HTMLDivElement>(null);

    // 添加新的状态
    const [currentSpeaker, setCurrentSpeaker] = useState(-1);
    const [lastActiveSpeaker, setLastActiveSpeaker] = useState(-1);





    useEffect(() => {
        let newSettings: { [key: string]: string } = {}
        if (agentEngine in agentSettings) {
            for (let setting of agentSettings[agentEngine]) {
                newSettings[setting.NAME] = setting.DEFAULT;
            }
            setSettings(newSettings);
        }
        Comm.getInstance().getConversionId(agentEngine, newSettings).then((id) => {
            console.log("conversationId: ", id);
            setConversationId(id);
        });
        clearChatRecord();
    }, [agentEngine, agentSettings]);

    // 监听 currentSpeaker 的变化，更新 lastActiveSpeaker
    useEffect(() => {
        if (currentSpeaker !== -1) {
            // 当有人说话时，更新最后说话人
            setLastActiveSpeaker(currentSpeaker);
        }
    }, [currentSpeaker]); // 依赖于 currentSpeaker 的变化

    // 监听 currentSpeaker 的变化
    useEffect(() => {
        if (currentSpeaker !== -1) {
            // 有人按下按钮，启动麦克风
            console.log(`Speaker ${currentSpeaker} started speaking`);
            if (!isRecording) {
                micClick(); // 启动麦克风
            }
        } else {
            // 按钮被松开，停止麦克风
            console.log("No one is speaking");
            if (isRecording) {
                micClick(); // 停止麦克风
            }
        }
    }, [currentSpeaker]); // 依赖于 currentSpeaker 的变化

    // 轮询按钮状态
    useEffect(() => {
        const pollSpeaker = () => {
            fetch('http://127.0.0.1:5000/get_current_speaker')
                .then(response => response.json())
                .then(data => {
                    if (data.status_code === 200) {
                        const speakerNum = parseInt(data.current_speaker);
                        setCurrentSpeaker(speakerNum);
                    }
                })
                .catch(error => {
                    console.error("Error fetching speaker:", error);
                });
        };

        pollSpeaker();
        const intervalId = setInterval(pollSpeaker, 200);

        return () => {
            clearInterval(intervalId);
        };
    }, []);


    // 添加获取说话人名称的函数
    const GetNameByQuery = async (speakerNumber: number, message: string): Promise<string> => {
        // First check if we have a cached name
        if (speakerNameCache.has(speakerNumber)) {
            return speakerNameCache.get(speakerNumber)!;
        }

        // If no cached name, make the API call
        try {
            const response = await fetch('http:///v1/chat-messages', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: {},
                    query: `${message}`,
                    response_mode: "blocking",
                    conversation_id: "",
                    user: "abc-123",
                    files: []
                })
            });

            const data = await response.json();
            if (data && data.answer) {
                // Cache the result
                speakerNameCache.set(speakerNumber, data.answer);
                return data.answer;
            }
        } catch (error) {
            console.error("Error fetching speaker name:", error);
        }
        
        // If we have no cached value and the request failed, return the default
        return `Speaker ${speakerNumber}`;
    }

  

    const chatWithAI = async (message: string) => {
        console.log("chatWithAI: ", message);


        // Get current speaker from button server
        fetch('http://127.0.0.1:5000/get_current_speaker')
            .then(response => response.json())
            .then(data => {
                if (data.status_code === 200) {
                    const speakerNum = data.current_speaker;
                    if (speakerNum === -1) {
                        console.log("No one is pressing the button");
                    } else {
                        console.log("Current speaker:", speakerNum);
                    }
                }
            })
            .catch(error => {
                console.error("Error fetching speaker:", error);
            });






        // add speaker to message
        const name = await GetNameByQuery(lastActiveSpeaker, message);
        message = `${name}: ${message}`;
        addChatRecord({ role: ChatRole.HUMAN, content: message });
        // 请求AI
        let responseText = "";
        let audioText = "";
        // 保证顺序执行
        let audioRecorderIndex = 0;
        let audioRecorderDict = new Map<number, ArrayBuffer>();
        addChatRecord({ role: ChatRole.AI, content: AI_THINK_MESSAGE });
        if (audioAutoStop) {
            CharacterManager.getInstance().clearAudioQueue();
        }
        Comm.getInstance().streamingChat(message, agentEngine, conversationId, settings, (index: number, data: string) => {
            responseText += data;
            updateLastRecord({ role: ChatRole.AI, content: responseText });
            if (!mute && mode != InteractionMode.CHATBOT) {
                // 按照标点符号断句处理
                audioText += data;
                // 断句判断符号
                // let punc = ["。", ".", "！", "!", "？", "?", "；", ";", "，", ",", "(", ")", "（", "）"];
                let punc = ["。", ".", "？", "?", "；", ";", "，", ","];
                // 找到最后一个包含这些符号的位置
                let lastPuncIndex = -1;
                for (let i = 0; i < punc.length; i++) {
                    let index = audioText.lastIndexOf(punc[i]);
                    if (index > lastPuncIndex) {
                        // 防止需要连续的符号断句
                        let firstPart = audioText.slice(0, index + 1);
                        if (firstPart.split("(").length - firstPart.split(")").length != 0) {
                            break;
                        }
                        if (firstPart.split("[").length - firstPart.split("]").length != 0) {
                            break;
                        }
                        lastPuncIndex = index;
                        break;
                    }
                }
                if (lastPuncIndex !== -1) {
                    let firstPart = audioText.slice(0, lastPuncIndex + 1);
                    let secondPart = audioText.slice(lastPuncIndex + 1);
                    console.log("tts:", firstPart);
                    Comm.getInstance().tts(firstPart, settings).then(
                        (data: ArrayBuffer) => {
                            if (data) {
                                audioRecorderDict.set(index, data);
                                while (true) {
                                    if (!audioRecorderDict.has(audioRecorderIndex)) break;
                                    CharacterManager.getInstance().pushAudioQueue(audioRecorderDict.get(audioRecorderIndex)!);
                                    audioRecorderIndex++;
                                }
                            }
                        }
                    )
                    audioText = secondPart;
                } else {
                    audioRecorderDict.set(index, null)
                }
            }
        }, (index: number) => {
            // 处理剩余tts
            if (!mute && audioText) {
                console.log("tts:", audioText);
                Comm.getInstance().tts(audioText, settings).then(
                    (data: ArrayBuffer) => {
                        if (data) {
                            audioRecorderDict.set(index, data);
                            while (true) {
                                if (!audioRecorderDict.has(audioRecorderIndex)) break;
                                CharacterManager.getInstance().pushAudioQueue(audioRecorderDict.get(audioRecorderIndex)!);
                                audioRecorderIndex++;
                            }
                        }
                    }
                )
            }
            setIsProcessing(false);
        });
    }


    const micClick = () => {
        if (isProcessing) return;
        if (micRecorder == null) {
            micRecorder = new Recorder({
                sampleBits: 16,         // 采样位数，支持 8 或 16，默认是16
                sampleRate: 16000,      // 采样率，支持 11025、16000、22050、24000、44100、48000，根据浏览器默认值，我的chrome是48000
                numChannels: 1,         // 声道，支持 1 或 2， 默认是1
            });
        }
        if (!isRecording) {
            if (audioAutoStop) {
                CharacterManager.getInstance().clearAudioQueue();
            }
            micRecorder.start().then(
                () => {
                    isRecording = true;
                    setMicRecording(true);
                },
                (error) => {
                    console.error(error);
                    setmicRecordAlert(true);
                }
            );
        } else {
            micRecorder.stop();
            isRecording = false;
            setMicRecording(false);
            setIsProcessing(true);
            Comm.getInstance().asr(micRecorder.getWAVBlob(), settings).then(
                (res) => {
                    console.log("asr: ", res);
                    if (res) {
                        chatWithAI(res);
                    } else {
                        setIsProcessing(false);
                    }
                }
            ).catch(
                (error) => {
                    setIsProcessing(false);
                }
            )
        }
    }

    const fileClick = () => {
        console.log("file clicked");
    }

    const sendClick = () => {
        if (inputRef.current.value === "") return;
        setIsProcessing(true);
        chatWithAI(inputRef.current.value);
        inputRef.current.value = "";
    }

    const enterPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            sendClick();
        }
    }

    // 定义一个防抖函数，用于处理 Ctrl + M 的按键组合  
    const handleCtrlM = debounce(() => {
        console.log('Ctrl + M was pressed!');
        micClick();
    }, 500); // 1000 毫秒内多次触发只执行一次   

    useEffect(() => {
        // 聊天滚动条到底部
        chatbotRef.current.scrollTop = chatbotRef.current.scrollHeight + 100;
        // 添加事件监听器  
        const handleKeyDown = (event: KeyboardEvent) => {
            // 检查是否按下了 Ctrl + M
            if (event.ctrlKey && event.key === 'm') {
                handleCtrlM();
            }
        };

        // 绑定事件监听器到 document 或其他适当的 DOM 元素  
        document.addEventListener('keydown', handleKeyDown);
        // 清理函数，用于移除事件监听器  
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    })

    // 定义输入框配置数组
    const inputBoxes = [
        { placeholder: "说话人1", showMic: true, speaker: "小红" },
        { placeholder: "说话人2", showMic: true, speaker: "小明" },
        { placeholder: "说话人3", showMic: true, speaker: "小华" }
    ];

    return (
        <div className="p-2 sm:p-6 justify-between flex flex-col h-full">
            {micRecordAlert ? <ConfirmAlert message={AUDIO_SUPPORT_ALERT} /> : null}
            <div id="messages" ref={chatbotRef} className="flex flex-col space-y-4 p-3 overflow-y-auto no-scrollbar z-10">
                {
                    showChatHistory ?
                        chatRecord.map((chat: ChatMessage, index: number) => (
                            <div className="chat-message" key={index}>
                                <div className={clsx(
                                    "flex items-end",
                                    chat.role == ChatRole.AI ? "" : "justify-end"
                                )}>
                                    <div className={clsx(
                                        "flex flex-col space-y-2 text-xs max-w-xs mx-2",
                                        chat.role == ChatRole.AI ? "order-2 items-start" : "order-1 items-end"
                                    )}>
                                        <div><Markdown className="px-4 py-2 rounded-lg inline-block rounded-bl-none bg-gray-300 text-gray-600">{chat.content}</Markdown></div>
                                    </div>
                                    <img src={chat.role == ChatRole.HUMAN ? "/icons/human_icon.svg" : "/icons/ai_icon.svg"} className="w-6 h-6 rounded-full order-1 self-start" />
                                </div>
                            </div>
                        ))
                        :
                        <></>
                }
            </div>

            <div className="space-y-4 px-4 pt-4 mb-2 sm:mb-0 z-10">
                {/* 使用 map 循环渲染输入框 */}
                {inputBoxes.map((box, index) => (
                    <div key={index} className="relative flex">
                        {/* 只在第一个输入框显示麦克风按钮 */}
                        {box.showMic && (
                            <div className="absolute inset-y-0 flex items-center">
                                <button type="button" onClick={micClick} disabled={isProcessing}
                                    className={clsx(
                                        "inline-flex items-center justify-center rounded-full h-12 w-12 transition duration-500 ease-in-out hover:bg-gray-300 focus:outline-none",
                                        micRecording ? "text-red-600" : "text-green-600",
                                    )}>
                                    {micRecording ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="size-6">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 0 1 9 14.437V9.564Z" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="size-6">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        )}
                        <input
                            enterKeyHint="send"
                            type="text"
                            disabled={isProcessing}
                            placeholder={box.placeholder}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && e.currentTarget.value) {
                                    // 格式化发送文本
                                    const formattedText = `${box.speaker}: ${e.currentTarget.value}`;
                                    chatWithAI(formattedText);
                                    e.currentTarget.value = "";
                                }
                            }}
                            className={clsx(
                                "w-full focus:outline-none focus:placeholder-gray-400 text-gray-600 placeholder-gray-600 bg-gray-200 rounded-md py-3",
                                box.showMic ? "pl-12" : "px-4"
                            )}
                        />
                        <div className="absolute right-0 items-center inset-y-0 hidden sm:flex">
                            <button type="button"
                                onClick={(e) => {
                                    const input = (e.currentTarget.parentNode?.previousSibling as HTMLInputElement);
                                    if (input?.value) {
                                        // 格式化发送文本
                                        const formattedText = `${box.speaker}: ${input.value}`;
                                        chatWithAI(formattedText);
                                        input.value = "";
                                    }
                                }}
                                disabled={isProcessing}
                                className="inline-flex items-center justify-center rounded-lg px-4 py-3 transition duration-500 ease-in-out text-white bg-blue-500 hover:bg-blue-400 focus:outline-none"
                            >
                                <span className="font-bold">Send</span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 ml-2 transform rotate-90">
                                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}