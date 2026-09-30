package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

type Code string

const (
	CodeValidation              Code = "validation_error"
	CodeUnauthorized            Code = "unauthorized"
	CodeForbidden               Code = "forbidden"
	CodeNotFound                Code = "not_found"
	CodeConflict                Code = "conflict"
	CodeRateLimited             Code = "rate_limited"
	CodeInternal                Code = "internal_error"
	CodeProfessionTypesRequired Code = "profession_types_required"
	CodeProfessionTypeLocked    Code = "profession_type_locked"
	CodeInsufficientStock       Code = "insufficient_stock"

	CodeInvalidCredentials          Code = "invalid_credentials"
	CodeEmailTaken                  Code = "email_already_registered"
	CodeAccountBlocked              Code = "account_blocked"
	CodeSessionExpired              Code = "session_expired"
	CodeAppointmentTimeConflict     Code = "appointment_time_conflict"
	CodeAppointmentStatusInvalid    Code = "appointment_status_invalid"
	CodeAppointmentConcurrent       Code = "appointment_concurrent_update"
	CodeAppointmentNotReschedulable Code = "appointment_not_reschedulable"
	CodeServicesDifferentSalon      Code = "services_different_salon"
	CodeProcedureOrderInvalid       Code = "procedure_order_invalid"
	CodeBookingPlanUnavailable      Code = "booking_plan_unavailable"
	CodeOccurrenceUnavailable       Code = "occurrence_unavailable"
	CodeOccurrenceFull              Code = "occurrence_full"
	CodeOccurrenceOverlap           Code = "occurrence_overlap"
	CodeBookingCutoff               Code = "booking_cutoff_passed"
	CodeClientBlacklisted           Code = "client_blacklisted"
	CodePlannerOutsideHours         Code = "planner_outside_hours"
	CodePlannerOverlap              Code = "planner_overlap"
	CodeMediaUnsupportedType        Code = "media_unsupported_type"
	CodeMediaTooLarge               Code = "media_too_large"
	CodeMediaEmpty                  Code = "media_empty"
	CodePriceChanged                Code = "price_changed"
	CodeContentNotAllowed           Code = "content_not_allowed"
	CodeMediaInvalidContent         Code = "media_invalid_content"
	CodeMediaTooManyRequests        Code = "media_rate_limited"
	CodeSessionInvalid              Code = "session_invalid"
	CodeInviteInvalid               Code = "invite_invalid"
	CodeInviteExpired               Code = "invite_expired"
	CodeInviteRevoked               Code = "invite_revoked"
	CodeInviteExhausted             Code = "invite_exhausted"
	CodeContactExists               Code = "contact_exists"
	CodeContactSelf                 Code = "contact_self"
)

type AppError struct {
	Code       Code
	Message    string
	HTTPStatus int
	Err        error
	Details    map[string]any
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

func (e *AppError) WithDetails(details map[string]any) *AppError {
	if e == nil {
		return nil
	}
	e.Details = details
	return e
}

func Validation(msg string) *AppError {
	return New(CodeValidation, http.StatusBadRequest, msg)
}

func ValidationCode(code Code, msg string) *AppError {
	return New(code, http.StatusBadRequest, msg)
}

func Unauthorized(msg string) *AppError {
	return New(CodeUnauthorized, http.StatusUnauthorized, msg)
}

func UnauthorizedCode(code Code, msg string) *AppError {
	return New(code, http.StatusUnauthorized, msg)
}

func Forbidden(msg string) *AppError {
	return New(CodeForbidden, http.StatusForbidden, msg)
}

func ForbiddenCode(code Code, msg string) *AppError {
	return New(code, http.StatusForbidden, msg)
}

func NotFound(msg string) *AppError {
	return New(CodeNotFound, http.StatusNotFound, msg)
}

func Conflict(msg string) *AppError {
	return New(CodeConflict, http.StatusConflict, msg)
}

func ConflictCode(code Code, msg string) *AppError {
	return New(code, http.StatusConflict, msg)
}

func Unprocessable(code Code, msg string) *AppError {
	return New(code, http.StatusUnprocessableEntity, msg)
}

func ProfessionTypesRequired() *AppError {
	return Unprocessable(CodeProfessionTypesRequired, "at least one profession type is required")
}

func ProfessionTypeLocked() *AppError {
	return New(CodeProfessionTypeLocked, http.StatusConflict, "profession type is locked and cannot be removed")
}

func InsufficientStock(msg string) *AppError {
	if msg == "" {
		msg = "Недостаточно товара на складе"
	}
	return New(CodeInsufficientStock, http.StatusConflict, msg)
}

// ContentNotAllowed reports user text that violates the moderation policy.
// fields are JSON field names; the offending words are never echoed back.
func ContentNotAllowed(fields ...string) *AppError {
	details := map[string]any{}
	if len(fields) > 0 {
		marks := make(map[string]string, len(fields))
		for _, f := range fields {
			marks[f] = "content_not_allowed"
		}
		details["fields"] = marks
	}
	return New(CodeContentNotAllowed, http.StatusUnprocessableEntity, "text contains words that are not allowed").WithDetails(details)
}

func RateLimited(msg string) *AppError {
	return New(CodeRateLimited, http.StatusTooManyRequests, msg)
}

func InvalidCredentials() *AppError {
	return UnauthorizedCode(CodeInvalidCredentials, "invalid credentials")
}

func EmailTaken() *AppError {
	return ConflictCode(CodeEmailTaken, "email already registered")
}

func AccountBlocked() *AppError {
	return ForbiddenCode(CodeAccountBlocked, "account is blocked")
}

func SessionExpired() *AppError {
	return UnauthorizedCode(CodeSessionExpired, "session expired")
}

func InviteInvalid() *AppError {
	return New(CodeInviteInvalid, http.StatusNotFound, "invite is not valid")
}

func InviteExpired() *AppError {
	return New(CodeInviteExpired, http.StatusGone, "invite expired")
}

func InviteRevoked() *AppError {
	return New(CodeInviteRevoked, http.StatusGone, "invite revoked")
}

func InviteExhausted() *AppError {
	return New(CodeInviteExhausted, http.StatusConflict, "invite has no remaining uses")
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
