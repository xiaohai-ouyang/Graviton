package client

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// encodeVarint encodes a uint64 into a protobuf varint.
func encodeVarint(val uint64) []byte {
	var buf []byte
	for val >= 0x80 {
		buf = append(buf, byte(val&0x7F|0x80))
		val >>= 7
	}
	buf = append(buf, byte(val))
	return buf
}

// readVarint reads a protobuf varint from data at offset.
func readVarint(data []byte, offset int) (uint64, int, error) {
	var result uint64
	var shift uint
	pos := offset

	for {
		if pos >= len(data) {
			return 0, offset, errors.New("incomplete varint data")
		}
		b := data[pos]
		result |= uint64(b&0x7F) << shift
		pos++
		if b&0x80 == 0 {
			break
		}
		shift += 7
	}
	return result, pos, nil
}

// skipField calculates the next offset after skipping the field with wireType.
func skipField(data []byte, offset int, wireType uint8) (int, error) {
	switch wireType {
	case 0: // Varint
		_, newOffset, err := readVarint(data, offset)
		return newOffset, err
	case 1: // 64-bit
		if offset+8 > len(data) {
			return 0, errors.New("incomplete 64-bit field")
		}
		return offset + 8, nil
	case 2: // Length-delimited
		length, contentOffset, err := readVarint(data, offset)
		if err != nil {
			return 0, err
		}
		newOffset := contentOffset + int(length)
		if newOffset > len(data) {
			return 0, errors.New("incomplete length-delimited field")
		}
		return newOffset, nil
	case 5: // 32-bit
		if offset+4 > len(data) {
			return 0, errors.New("incomplete 32-bit field")
		}
		return offset + 4, nil
	default:
		return 0, fmt.Errorf("unknown wire type: %d", wireType)
	}
}

// encodeLenDelimField encodes a length-delimited field.
func encodeLenDelimField(fieldNum uint32, data []byte) []byte {
	tag := (fieldNum << 3) | 2
	f := encodeVarint(uint64(tag))
	f = append(f, encodeVarint(uint64(len(data)))...)
	f = append(f, data...)
	return f
}

// encodeStringField encodes a string as length-delimited field.
func encodeStringField(fieldNum uint32, val string) []byte {
	return encodeLenDelimField(fieldNum, []byte(val))
}

// encodeVarintField encodes a varint field.
func encodeVarintField(fieldNum uint32, val uint64) []byte {
	tag := (fieldNum << 3) | 0
	f := encodeVarint(uint64(tag))
	f = append(f, encodeVarint(val)...)
	return f
}

// findField finds the first length-delimited field with targetField number.
func findField(data []byte, targetField uint32) ([]byte, bool, error) {
	offset := 0
	for offset < len(data) {
		tag, newOffset, err := readVarint(data, offset)
		if err != nil {
			break
		}
		wireType := uint8(tag & 7)
		fieldNum := uint32(tag >> 3)

		if fieldNum == targetField && wireType == 2 {
			length, contentOffset, err := readVarint(data, newOffset)
			if err != nil {
				return nil, false, err
			}
			endOffset := contentOffset + int(length)
			if endOffset > len(data) {
				return nil, false, errors.New("invalid field length")
			}
			return data[contentOffset:endOffset], true, nil
		}

		nextOffset, err := skipField(data, newOffset, wireType)
		if err != nil {
			return nil, false, err
		}
		offset = nextOffset
	}
	return nil, false, nil
}

// findAllFields finds all length-delimited occurrences of targetField.
func findAllFields(data []byte, targetField uint32) ([][]byte, error) {
	var results [][]byte
	offset := 0
	for offset < len(data) {
		tag, newOffset, err := readVarint(data, offset)
		if err != nil {
			break
		}
		wireType := uint8(tag & 7)
		fieldNum := uint32(tag >> 3)

		if fieldNum == targetField && wireType == 2 {
			length, contentOffset, err := readVarint(data, newOffset)
			if err != nil {
				return nil, err
			}
			endOffset := contentOffset + int(length)
			if endOffset <= len(data) {
				results = append(results, data[contentOffset:endOffset])
			}
			offset = endOffset
		} else {
			nextOffset, err := skipField(data, newOffset, wireType)
			if err != nil {
				return nil, err
			}
			offset = nextOffset
		}
	}
	return results, nil
}

// CreateOAuthInfo builds the OAuthTokenInfo binary message according to upstream specification.
func CreateOAuthInfo(accessToken, refreshToken string, expiry int64, isGCPTos bool, idToken string, email string) []byte {
	// Auto correct isGCPTos for personal emails
	if email != "" {
		lower := strings.ToLower(email)
		if strings.HasSuffix(lower, "@gmail.com") ||
			strings.HasSuffix(lower, "@outlook.com") ||
			strings.HasSuffix(lower, "@hotmail.com") ||
			strings.HasSuffix(lower, "@qq.com") ||
			strings.HasSuffix(lower, "@163.com") {
			isGCPTos = false
		}
	}

	// Field 1: access_token
	field1 := encodeStringField(1, accessToken)

	// Field 2: token_type = "Bearer"
	field2 := encodeStringField(2, "Bearer")

	// Field 3: refresh_token
	field3 := encodeStringField(3, refreshToken)

	// Field 4: expiry Timestamp message (seconds = 1, nanos = 2)
	secTag := (1 << 3) | 0
	tsMsg := encodeVarint(uint64(secTag))
	tsMsg = append(tsMsg, encodeVarint(uint64(expiry))...)
	nanoTag := (2 << 3) | 0
	tsMsg = append(tsMsg, encodeVarint(uint64(nanoTag))...)
	tsMsg = append(tsMsg, encodeVarint(0)...)
	field4 := encodeLenDelimField(4, tsMsg)

	var oauthInfo []byte
	oauthInfo = append(oauthInfo, field1...)
	oauthInfo = append(oauthInfo, field2...)
	oauthInfo = append(oauthInfo, field3...)
	oauthInfo = append(oauthInfo, field4...)

	// Field 5: id_token (if present)
	if idToken != "" {
		oauthInfo = append(oauthInfo, encodeStringField(5, idToken)...)
	}

	// Field 6: is_gcp_tos
	if isGCPTos {
		oauthInfo = append(oauthInfo, encodeVarintField(6, 1)...)
	}

	return oauthInfo
}

// CreateUnifiedTopicEntry creates a Topic.data entry: Field 1 (sentinel_key), Field 2 (Row: Field 1 base64(payload)).
func CreateUnifiedTopicEntry(sentinelKey string, payload []byte) []byte {
	row := encodeStringField(1, base64.StdEncoding.EncodeToString(payload))
	entry := append(encodeStringField(1, sentinelKey), encodeLenDelimField(2, row)...)
	return encodeLenDelimField(1, entry)
}

// RemoveUnifiedTopicEntry removes an entry with matching targetKey from Topic.data blob.
func RemoveUnifiedTopicEntry(data []byte, targetKey string) ([]byte, error) {
	var result []byte
	offset := 0

	for offset < len(data) {
		startOffset := offset
		tag, newOffset, err := readVarint(data, offset)
		if err != nil {
			break
		}
		wireType := uint8(tag & 7)
		fieldNum := uint32(tag >> 3)
		nextOffset, err := skipField(data, newOffset, wireType)
		if err != nil {
			return nil, err
		}

		shouldRemove := false
		if fieldNum == 1 && wireType == 2 {
			length, contentOffset, err := readVarint(data, newOffset)
			if err == nil {
				entryLen := int(length)
				if contentOffset+entryLen <= len(data) {
					entry := data[contentOffset : contentOffset+entryLen]
					if key, ok := unifiedTopicEntryKey(entry); ok && key == targetKey {
						shouldRemove = true
					}
				}
			}
		}

		if !shouldRemove {
			result = append(result, data[startOffset:nextOffset]...)
		}
		offset = nextOffset
	}

	return result, nil
}

func unifiedTopicEntryKey(data []byte) (string, bool) {
	offset := 0
	for offset < len(data) {
		tag, newOffset, err := readVarint(data, offset)
		if err != nil {
			return "", false
		}
		wireType := uint8(tag & 7)
		fieldNum := uint32(tag >> 3)

		if fieldNum == 1 && wireType == 2 {
			length, contentOffset, err := readVarint(data, newOffset)
			if err != nil {
				return "", false
			}
			entryLen := int(length)
			if contentOffset+entryLen > len(data) {
				return "", false
			}
			return string(data[contentOffset : contentOffset+entryLen]), true
		}

		nextOffset, err := skipField(data, newOffset, wireType)
		if err != nil {
			return "", false
		}
		offset = nextOffset
	}
	return "", false
}

// CreateMinimalUserStatusPayload creates minimal payload for userStatus (Field 3 email, Field 7 email).
func CreateMinimalUserStatusPayload(email string) []byte {
	res := encodeStringField(3, email)
	res = append(res, encodeStringField(7, email)...)
	return res
}

// CreateUnifiedStateEntry wraps payload as: Topic(Field 1 DataEntry) -> Base64 string.
func CreateUnifiedStateEntry(sentinelKey string, payload []byte) string {
	row := encodeStringField(1, base64.StdEncoding.EncodeToString(payload))
	dataEntry := append(encodeStringField(1, sentinelKey), encodeLenDelimField(2, row)...)
	topic := encodeLenDelimField(1, dataEntry)
	return base64.StdEncoding.EncodeToString(topic)
}

// DecodeOAuthInfo decodes binary OAuthTokenInfo payload.
func DecodeOAuthInfo(payload []byte) (accessToken, refreshToken string, expiry int64, email string, err error) {
	offset := 0
	for offset < len(payload) {
		tag, newOffset, err := readVarint(payload, offset)
		if err != nil {
			break
		}
		wireType := uint8(tag & 7)
		fieldNum := uint32(tag >> 3)

		if wireType == 2 {
			length, contentOffset, err := readVarint(payload, newOffset)
			if err != nil {
				return "", "", 0, "", err
			}
			endOffset := contentOffset + int(length)
			if endOffset > len(payload) {
				return "", "", 0, "", errors.New("field length exceeds payload")
			}
			fieldBytes := payload[contentOffset:endOffset]

			switch fieldNum {
			case 1:
				accessToken = string(fieldBytes)
			case 3:
				refreshToken = string(fieldBytes)
			case 4: // Timestamp message
				tsOffset := 0
				for tsOffset < len(fieldBytes) {
					tTag, tNewOffset, err := readVarint(fieldBytes, tsOffset)
					if err != nil {
						break
					}
					tWire := uint8(tTag & 7)
					tNum := uint32(tTag >> 3)
					if tNum == 1 && tWire == 0 {
						sec, _, _ := readVarint(fieldBytes, tNewOffset)
						expiry = int64(sec)
						break
					}
					next, err := skipField(fieldBytes, tNewOffset, tWire)
					if err != nil {
						break
					}
					tsOffset = next
				}
			}
			offset = endOffset
		} else {
			nextOffset, err := skipField(payload, newOffset, wireType)
			if err != nil {
				return "", "", 0, "", err
			}
			offset = nextOffset
		}
	}

	return accessToken, refreshToken, expiry, email, nil
}
