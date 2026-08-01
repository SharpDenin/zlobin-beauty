package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

type Code string

const (
	CodeValidation   Code = "validation_error"
	CodeUnauthorized Code = "unauthorized"
	CodeForbidden    Code = "forbidden"
	CodeNotFound     Code = "not_found"
	CodeConflict     Code = "conflict"
	CodeRateLimited  Code = "rate_limited"
	CodeInternal     Code = "internal_error"
)

type AppError struct {
	Code       Code
	Message    string
	HTTPStatus int
	Err        error
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *AppError) Unwrap() error { return e.Err }

func New(code Code, status int, message string) *AppError {
	return &AppError{Code: code, HTTPStatus: status, Message: message}
}

func Validation(msg string) *AppError {
	return New(CodeValidation, http.StatusBadRequest, msg)
}

func Unauthorized(msg string) *AppError {
	return New(CodeUnauthorized, http.StatusUnauthorized, msg)
}

func Forbidden(msg string) *AppError {
	return New(CodeForbidden, http.StatusForbidden, msg)
}

func NotFound(msg string) *AppError {
	return New(CodeNotFound, http.StatusNotFound, msg)
}

func Conflict(msg string) *AppError {
	return New(CodeConflict, http.StatusConflict, msg)
}

func RateLimited(msg string) *AppError {
	return New(CodeRateLimited, http.StatusTooManyRequests, msg)
}

func Internal(err error) *AppError {
	return &AppError{Code: CodeInternal, HTTPStatus: http.StatusInternalServerError, Message: "internal error", Err: err}
}

func As(err error) (*AppError, bool) {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae, true
	}
	return nil, false
}
