package socket

type commandExtensionHandler func(w *WebSocketReporter, cmd CommandMessage, response *CommandResponse) (bool, error)

var commandExtensionHandlers []commandExtensionHandler

func registerCommandExtension(handler commandExtensionHandler) {
	if handler == nil {
		return
	}
	commandExtensionHandlers = append(commandExtensionHandlers, handler)
}

func (w *WebSocketReporter) routeCommandExtension(cmd CommandMessage, response *CommandResponse) (bool, error) {
	for _, handler := range commandExtensionHandlers {
		matched, err := handler(w, cmd, response)
		if matched {
			return true, err
		}
	}
	return false, nil
}
